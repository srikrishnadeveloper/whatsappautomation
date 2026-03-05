/**
 * Embedding Service — Google text-embedding-004 via Generative AI SDK
 *
 * Generates 768-dimension embeddings for messages and queries.
 * Used by the hybrid RAG pipeline for vector similarity search.
 *
 * Features:
 *  - Batch embedding with concurrency control
 *  - In-memory cache to avoid redundant API calls
 *  - Automatic retry on transient failures
 *  - Stores embeddings in Supabase pgvector column
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSupabaseClient } from '../config/supabase';
import log from './activity-log';

// ── Config ──────────────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-004';
const EMBEDDING_DIMENSIONS = 768;
const BATCH_SIZE = 100;           // Google allows up to 100 in a batch
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

let genAI: GoogleGenerativeAI | null = null;
let embeddingModel: any = null;

// In-memory cache: messageId → embedding vector (avoids re-embedding on restart within session)
const embeddingCache = new Map<string, number[]>();

// ── Initialization ──────────────────────────────────────────────────────────

export function initEmbeddingService(): boolean {
  if (!GEMINI_API_KEY) {
    console.warn('⚠️  Embedding service: No GEMINI/GOOGLE_AI API key found');
    return false;
  }
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  console.log(`✅ Embedding service initialized — model: ${EMBEDDING_MODEL} (${EMBEDDING_DIMENSIONS}d)`);
  return true;
}

// ── Core: Generate embedding for a single text ─────────────────────────────

export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!embeddingModel) {
    if (!initEmbeddingService()) return null;
  }

  // Truncate very long texts (embedding models have limits)
  const truncated = text.slice(0, 8000);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await embeddingModel!.embedContent(truncated);
      const embedding = result.embedding?.values;
      if (embedding && embedding.length === EMBEDDING_DIMENSIONS) {
        return embedding;
      }
      // If dimensions don't match, try to slice or pad
      if (embedding && embedding.length > 0) {
        if (embedding.length > EMBEDDING_DIMENSIONS) {
          return embedding.slice(0, EMBEDDING_DIMENSIONS);
        }
        // Pad with zeros if shorter (shouldn't happen)
        const padded = [...embedding, ...new Array(EMBEDDING_DIMENSIONS - embedding.length).fill(0)];
        return padded;
      }
      log.error('Embedding returned empty result', `attempt=${attempt + 1}`);
    } catch (err: any) {
      const isRetryable = err.status === 429 || err.status === 503 || err.message?.includes('RESOURCE_EXHAUSTED');
      if (isRetryable && attempt < MAX_RETRIES - 1) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        log.info('Embedding retry', `attempt=${attempt + 1} delay=${delay}ms`);
        await sleep(delay);
        continue;
      }
      log.error('Embedding generation failed', `${err.message} (attempt ${attempt + 1})`);
      return null;
    }
  }
  return null;
}

// ── Generate embeddings for multiple texts ──────────────────────────────────

export async function generateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
  if (!embeddingModel) {
    if (!initEmbeddingService()) return texts.map(() => null);
  }

  const results: (number[] | null)[] = [];

  // Process in batches
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map(t => t.slice(0, 8000));

    try {
      const batchResult = await embeddingModel!.batchEmbedContents({
        requests: batch.map((text: string) => ({
          content: { parts: [{ text }] },
        })),
      });

      for (const emb of batchResult.embeddings) {
        if (emb?.values && emb.values.length > 0) {
          results.push(emb.values.slice(0, EMBEDDING_DIMENSIONS));
        } else {
          results.push(null);
        }
      }
    } catch (err: any) {
      log.error('Batch embedding failed', `batch ${i}-${i + batch.length}: ${err.message}`);
      // Fall back to individual embedding for this batch
      for (const text of batch) {
        results.push(await generateEmbedding(text));
      }
    }

    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < texts.length) {
      await sleep(200);
    }
  }

  return results;
}

// ── Build text for embedding from message fields ────────────────────────────

export function buildEmbeddingText(msg: {
  sender: string;
  chat_name?: string | null;
  content: string;
  metadata?: any;
}): string {
  const parts: string[] = [];
  if (msg.sender) parts.push(`From: ${msg.sender}`);
  if (msg.chat_name) parts.push(`Chat: ${msg.chat_name}`);
  parts.push(msg.content);
  // Include subject from metadata if present (e.g., email subject)
  if (msg.metadata?.subject) parts.push(`Subject: ${msg.metadata.subject}`);
  return parts.join('\n');
}

// ── Store embedding in Supabase ─────────────────────────────────────────────

export async function storeEmbedding(messageId: string, embedding: number[]): Promise<boolean> {
  try {
    const db = getSupabaseClient();
    // pgvector expects the embedding as a string like '[0.1,0.2,...]'
    const vectorStr = `[${embedding.join(',')}]`;

    const { error } = await db
      .from('messages')
      .update({ embedding: vectorStr } as any)
      .eq('id', messageId);

    if (error) {
      log.error('Store embedding failed', `${messageId}: ${error.message}`);
      return false;
    }

    embeddingCache.set(messageId, embedding);
    return true;
  } catch (err: any) {
    log.error('Store embedding exception', `${messageId}: ${err.message}`);
    return false;
  }
}

// ── Embed a single message (generate + store) ──────────────────────────────

export async function embedMessage(msg: {
  id: string;
  sender: string;
  chat_name?: string | null;
  content: string;
  metadata?: any;
}): Promise<boolean> {
  if (embeddingCache.has(msg.id)) return true; // Already cached

  const text = buildEmbeddingText(msg);
  if (text.trim().length < 5) return false; // Skip very short/empty content

  const embedding = await generateEmbedding(text);
  if (!embedding) return false;

  return storeEmbedding(msg.id, embedding);
}

// ── Batch embed messages ────────────────────────────────────────────────────

export async function embedMessages(
  messages: Array<{
    id: string;
    sender: string;
    chat_name?: string | null;
    content: string;
    metadata?: any;
  }>,
): Promise<{ success: number; failed: number; skipped: number }> {
  let success = 0;
  let failed = 0;
  let skipped = 0;

  // Filter out already-cached and too-short messages
  const toEmbed: typeof messages = [];
  const texts: string[] = [];

  for (const msg of messages) {
    if (embeddingCache.has(msg.id)) {
      skipped++;
      continue;
    }
    const text = buildEmbeddingText(msg);
    if (text.trim().length < 5) {
      skipped++;
      continue;
    }
    toEmbed.push(msg);
    texts.push(text);
  }

  if (toEmbed.length === 0) {
    return { success: 0, failed: 0, skipped };
  }

  log.info('Batch embedding', `Processing ${toEmbed.length} messages (${skipped} skipped)`);
  const embeddings = await generateEmbeddings(texts);

  for (let i = 0; i < toEmbed.length; i++) {
    const emb = embeddings[i];
    if (emb) {
      const stored = await storeEmbedding(toEmbed[i].id, emb);
      if (stored) success++; else failed++;
    } else {
      failed++;
    }
  }

  log.info('Batch embedding complete', `success=${success} failed=${failed} skipped=${skipped}`);
  return { success, failed, skipped };
}

// ── Backfill: embed all messages that lack embeddings ───────────────────────

export async function backfillEmbeddings(userId?: string): Promise<{ success: number; failed: number; total: number }> {
  try {
    const db = getSupabaseClient();

    // Find messages without embeddings
    let query = db
      .from('messages')
      .select('id, sender, chat_name, content, metadata')
      .is('embedding', null)
      .order('created_at', { ascending: false })
      .limit(500); // Process 500 at a time to avoid timeout

    if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query;
    if (error) {
      log.error('Backfill query failed', error.message);
      return { success: 0, failed: 0, total: 0 };
    }

    if (!data || data.length === 0) {
      log.info('Backfill complete', 'All messages already have embeddings');
      return { success: 0, failed: 0, total: 0 };
    }

    log.info('Backfilling embeddings', `${data.length} messages to process`);
    const result = await embedMessages(data);
    return { ...result, total: data.length };
  } catch (err: any) {
    log.error('Backfill exception', err.message);
    return { success: 0, failed: 0, total: 0 };
  }
}

// ── Query embedding (for search) ────────────────────────────────────────────

export async function embedQuery(query: string): Promise<number[] | null> {
  return generateEmbedding(query);
}

// ── Vector search via Supabase RPC ──────────────────────────────────────────

export async function vectorSearch(
  queryEmbedding: number[],
  userId?: string,
  matchCount: number = 50,
  matchThreshold: number = 0.3,
): Promise<Array<{
  id: string;
  sender: string;
  chat_name: string | null;
  timestamp: string;
  content: string;
  message_type: string;
  classification: string | null;
  metadata: any;
  priority: string | null;
  similarity: number;
}>> {
  try {
    const db = getSupabaseClient();
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    const { data, error } = await db.rpc('match_messages', {
      query_embedding: vectorStr,
      match_threshold: matchThreshold,
      match_count: matchCount,
      p_user_id: userId || null,
    });

    if (error) {
      log.error('Vector search failed', error.message);
      return [];
    }

    return data || [];
  } catch (err: any) {
    log.error('Vector search exception', err.message);
    return [];
  }
}

// ── Hybrid search via Supabase RPC ──────────────────────────────────────────

export async function hybridSearchDB(
  queryEmbedding: number[],
  queryText: string,
  userId?: string,
  matchCount: number = 50,
  vectorWeight: number = 0.7,
  textWeight: number = 0.3,
): Promise<Array<{
  id: string;
  sender: string;
  chat_name: string | null;
  timestamp: string;
  content: string;
  message_type: string;
  classification: string | null;
  metadata: any;
  priority: string | null;
  vector_score: number;
  text_score: number;
  combined_score: number;
}>> {
  try {
    const db = getSupabaseClient();
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    const { data, error } = await db.rpc('hybrid_search', {
      query_embedding: vectorStr,
      query_text: queryText,
      match_count: matchCount,
      p_user_id: userId || null,
      vector_weight: vectorWeight,
      text_weight: textWeight,
    });

    if (error) {
      log.error('Hybrid search DB failed', error.message);
      return [];
    }

    return data || [];
  } catch (err: any) {
    log.error('Hybrid search DB exception', err.message);
    return [];
  }
}

// ── Cache stats ─────────────────────────────────────────────────────────────

export function getEmbeddingStats() {
  return {
    cacheSize: embeddingCache.size,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
  };
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
