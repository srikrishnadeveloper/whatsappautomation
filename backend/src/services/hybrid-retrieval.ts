/**
 * Hybrid Retrieval Service — Orchestrates the full RAG pipeline
 *
 * Pipeline:
 *  1. Query rewriting (clarify ambiguous queries)
 *  2. Parallel retrieval: vector search + keyword search
 *  3. Merge & deduplicate results
 *  4. Reranking (multi-signal scoring)
 *  5. Return top-K context candidates
 *
 * This replaces the old searchByKeywords-only approach with a
 * hybrid vector + keyword + reranker architecture.
 */

import { embedQuery, hybridSearchDB, vectorSearch } from './embedding-service';
import { rerank, RerankCandidate, RerankResult } from './reranker-service';
import { getCachedResponse, setCachedResponse } from './response-cache';
import { getSupabaseClient } from '../config/supabase';
import log from './activity-log';

// ── Types ───────────────────────────────────────────────────────────────────

export interface RetrievalOptions {
  userId?: string;
  maxResults?: number;
  vectorWeight?: number;
  textWeight?: number;
  includeKeywordFallback?: boolean;
  dateRange?: { start: Date; end: Date } | null;
}

export interface RetrievalResult {
  candidates: RerankResult[];
  stats: {
    vectorHits: number;
    keywordHits: number;
    hybridHits: number;
    afterRerank: number;
    queryRewritten: boolean;
    retrievalTimeMs: number;
  };
  rewrittenQuery?: string;
}

// ── Query Rewriting ─────────────────────────────────────────────────────────

/**
 * Rewrites ambiguous or conversational queries into clearer search queries.
 * Uses heuristic rules (fast, no API call needed).
 */
export function rewriteQuery(query: string, conversationContext?: string): string {
  let rewritten = query.trim();

  // Remove conversational filler
  rewritten = rewritten
    .replace(/^(hey|hi|hello|please|can you|could you|would you|i want to|i need to|help me)\s+/i, '')
    .replace(/\s*(please|thanks|thank you|plz)\s*$/i, '')
    .replace(/^(show me|tell me|find|search for|look for|get me|give me)\s+/i, '')
    .trim();

  // Expand abbreviations
  rewritten = rewritten
    .replace(/\bmsgs?\b/gi, 'messages')
    .replace(/\bconvo\b/gi, 'conversation')
    .replace(/\binfo\b/gi, 'information')
    .replace(/\btmrw\b/gi, 'tomorrow')
    .replace(/\bydy\b/gi, 'yesterday')
    .replace(/\basap\b/gi, 'as soon as possible')
    .replace(/\bmtg\b/gi, 'meeting')
    .replace(/\bppt\b/gi, 'presentation');

  // Add context from conversation if available (e.g., resolving pronouns)
  if (conversationContext) {
    // If query uses pronouns without context, try to resolve
    if (/^(what about|and|also|more about)\s/i.test(rewritten)) {
      rewritten = `${conversationContext} ${rewritten}`;
    }
  }

  // If query is too short after cleaning, use original
  if (rewritten.length < 3) rewritten = query.trim();

  return rewritten;
}

// ── Advanced query rewriting using LLM ──────────────────────────────────────

export async function rewriteQueryWithAI(
  query: string,
  conversationHistory: Array<{ role: string; content: string }>,
): Promise<string> {
  // For now, use heuristic rewriting
  // In the future, this can call a lightweight model for query expansion
  const lastUserMsg = conversationHistory
    .filter(m => m.role === 'user')
    .slice(-2)
    .map(m => m.content)
    .join(' ');

  return rewriteQuery(query, lastUserMsg.length > 5 ? lastUserMsg : undefined);
}

// ── Core Hybrid Retrieval ───────────────────────────────────────────────────

export async function hybridRetrieve(
  query: string,
  inMemoryMessages: Array<{
    id: string;
    sender: string;
    chat_name: string | null;
    timestamp: string;
    content: string;
    message_type?: string;
    classification?: string | null;
    metadata?: any;
    priority?: string | null;
  }>,
  options: RetrievalOptions = {},
): Promise<RetrievalResult> {
  const startTime = Date.now();
  const {
    userId,
    maxResults = 50,
    vectorWeight = 0.7,
    textWeight = 0.3,
    dateRange,
  } = options;

  // Step 1: Rewrite query for better retrieval
  const rewrittenQuery = rewriteQuery(query);
  const queryRewritten = rewrittenQuery !== query.trim();

  let vectorHits = 0;
  let keywordHits = 0;
  let hybridHits = 0;

  const candidateMap = new Map<string, RerankCandidate>();

  // Step 2: Vector + Text hybrid search from DB (pgvector + full-text)
  try {
    const queryEmbedding = await embedQuery(rewrittenQuery);

    if (queryEmbedding) {
      // Use the hybrid SQL function that combines vector + text search
      const hybridResults = await hybridSearchDB(
        queryEmbedding,
        rewrittenQuery,
        userId,
        maxResults * 2,
        vectorWeight,
        textWeight,
      );

      hybridHits = hybridResults.length;

      for (const r of hybridResults) {
        candidateMap.set(r.id, {
          id: r.id,
          sender: r.sender,
          chat_name: r.chat_name,
          timestamp: r.timestamp,
          content: r.content,
          message_type: r.message_type,
          classification: r.classification,
          metadata: r.metadata,
          priority: r.priority,
          vector_score: r.vector_score,
          text_score: r.text_score,
          combined_score: r.combined_score,
        });
      }

      // Also do pure vector search for semantic matches that text search might miss
      const vectorResults = await vectorSearch(queryEmbedding, userId, maxResults);
      vectorHits = vectorResults.length;

      for (const r of vectorResults) {
        if (!candidateMap.has(r.id)) {
          candidateMap.set(r.id, {
            id: r.id,
            sender: r.sender,
            chat_name: r.chat_name,
            timestamp: r.timestamp,
            content: r.content,
            message_type: r.message_type,
            classification: r.classification,
            metadata: r.metadata,
            priority: r.priority,
            similarity: r.similarity,
          });
        }
      }
    }
  } catch (err: any) {
    log.error('Hybrid retrieval vector search failed', err.message);
  }

  // Step 3: Keyword search from in-memory messages (fallback + supplement)
  const queryTerms = rewrittenQuery.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  if (queryTerms.length > 0) {
    const keywordMatches = inMemoryMessages.filter(m => {
      const blob = `${m.sender} ${m.chat_name || ''} ${m.content}`.toLowerCase();
      return queryTerms.some(t => blob.includes(t));
    });

    keywordHits = keywordMatches.length;

    for (const m of keywordMatches) {
      if (!candidateMap.has(m.id)) {
        // Compute a simple keyword score
        const blob = `${m.sender} ${m.chat_name || ''} ${m.content}`.toLowerCase();
        const matchCount = queryTerms.filter(t => blob.includes(t)).length;
        const text_score = matchCount / queryTerms.length;

        candidateMap.set(m.id, {
          ...m,
          text_score,
          vector_score: 0,
          combined_score: text_score * 0.3,
        });
      }
    }
  }

  // Step 4: Apply date range filter if specified
  let allCandidates = Array.from(candidateMap.values());
  if (dateRange) {
    const startMs = dateRange.start.getTime();
    const endMs = dateRange.end.getTime();
    allCandidates = allCandidates.filter(c => {
      const ts = new Date(c.timestamp).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }

  // Step 5: Rerank
  const reranked = rerank(rewrittenQuery, allCandidates, maxResults);

  const retrievalTimeMs = Date.now() - startTime;

  log.info('Hybrid retrieval complete',
    `query="${query.slice(0, 40)}" vectorHits=${vectorHits} keywordHits=${keywordHits} hybridHits=${hybridHits} reranked=${reranked.length} time=${retrievalTimeMs}ms`
  );

  return {
    candidates: reranked,
    stats: {
      vectorHits,
      keywordHits,
      hybridHits,
      afterRerank: reranked.length,
      queryRewritten,
      retrievalTimeMs,
    },
    rewrittenQuery: queryRewritten ? rewrittenQuery : undefined,
  };
}

// ── Convenience: retrieve with caching ──────────────────────────────────────

export async function hybridRetrieveWithCache(
  query: string,
  inMemoryMessages: any[],
  userId: string,
  options: RetrievalOptions = {},
): Promise<RetrievalResult> {
  // Check cache
  const cacheKey = `retrieval:${query}`;
  const cached = await getCachedResponse(cacheKey, userId);
  if (cached) {
    log.info('Hybrid retrieval cache hit', `query="${query.slice(0, 40)}"`);
    return cached;
  }

  // Perform retrieval
  const result = await hybridRetrieve(query, inMemoryMessages, { ...options, userId });

  // Cache result (non-blocking)
  setCachedResponse(cacheKey, userId, result).catch(() => {});

  return result;
}
