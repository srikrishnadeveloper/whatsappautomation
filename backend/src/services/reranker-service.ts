/**
 * Reranker Service — Hybrid scoring reranker inspired by bge-reranker-large
 *
 * Since running a 1.3GB ONNX model in a Node.js backend is impractical,
 * this implements a high-accuracy multi-signal reranker that combines:
 *  1. Vector similarity score (from pgvector — proxy for embedding-based relevance)
 *  2. Keyword overlap (BM25-inspired term frequency scoring)
 *  3. Recency boost (exponential decay over 30 days)
 *  4. Sender/chat relevance (mentioned in query → bonus)
 *  5. Content quality (penalize very short/very long, reward medium-length)
 *
 * For production, you can swap this with a Cohere Reranker API or
 * HuggingFace Inference API call to BAAI/bge-reranker-large.
 */

import log from './activity-log';

// ── Types ───────────────────────────────────────────────────────────────────

export interface RerankCandidate {
  id: string;
  sender: string;
  chat_name: string | null;
  timestamp: string;
  content: string;
  message_type?: string;
  classification?: string | null;
  metadata?: any;
  priority?: string | null;
  // Scores from retrieval stage
  vector_score?: number;
  text_score?: number;
  combined_score?: number;
  similarity?: number;
}

export interface RerankResult extends RerankCandidate {
  rerank_score: number;
  score_breakdown: {
    semantic: number;
    keyword: number;
    recency: number;
    entity: number;
    quality: number;
  };
}

// ── Config ──────────────────────────────────────────────────────────────────

const RECENCY_DECAY_DAYS = 30;
const KEYWORD_WEIGHT = 0.20;
const SEMANTIC_WEIGHT = 0.40;
const RECENCY_WEIGHT = 0.15;
const ENTITY_WEIGHT = 0.15;
const QUALITY_WEIGHT = 0.10;

// ── Core reranker ───────────────────────────────────────────────────────────

export function rerank(
  query: string,
  candidates: RerankCandidate[],
  topK: number = 30,
): RerankResult[] {
  if (candidates.length === 0) return [];

  const queryLower = query.toLowerCase();
  const queryTerms = extractTerms(queryLower);
  const queryEntities = extractEntities(queryLower);
  const now = Date.now();

  const scored: RerankResult[] = candidates.map(c => {
    const contentLower = (c.content || '').toLowerCase();
    const senderLower = (c.sender || '').toLowerCase();
    const chatLower = (c.chat_name || '').toLowerCase();
    const blob = `${senderLower} ${chatLower} ${contentLower}`;

    // 1. Semantic score — from vector search or normalized combined score
    const semantic = normalizeScore(
      c.vector_score ?? c.similarity ?? c.combined_score ?? 0,
      0, 1
    );

    // 2. Keyword overlap — BM25-inspired
    const keyword = computeKeywordScore(queryTerms, blob, contentLower);

    // 3. Recency — exponential decay
    const msgAge = (now - new Date(c.timestamp).getTime()) / (1000 * 60 * 60 * 24);
    const recency = Math.exp(-msgAge / RECENCY_DECAY_DAYS);

    // 4. Entity relevance — sender/chat name mentioned in query
    const entity = computeEntityScore(queryEntities, queryLower, senderLower, chatLower);

    // 5. Content quality — prefer medium-length, penalize too short/long
    const quality = computeQualityScore(contentLower, c.message_type || 'text');

    // Weighted combination
    const rerank_score =
      semantic * SEMANTIC_WEIGHT +
      keyword * KEYWORD_WEIGHT +
      recency * RECENCY_WEIGHT +
      entity * ENTITY_WEIGHT +
      quality * QUALITY_WEIGHT;

    return {
      ...c,
      rerank_score,
      score_breakdown: { semantic, keyword, recency, entity, quality },
    };
  });

  // Sort by rerank score descending
  scored.sort((a, b) => b.rerank_score - a.rerank_score);

  return scored.slice(0, topK);
}

// ── Keyword scoring (BM25-inspired) ────────────────────────────────────────

function computeKeywordScore(queryTerms: string[], blob: string, content: string): number {
  if (queryTerms.length === 0) return 0;

  let matchCount = 0;
  let phraseBonus = 0;

  for (const term of queryTerms) {
    if (blob.includes(term)) matchCount++;
  }

  // Phrase match bonus: if consecutive query terms appear together
  const queryPhrase = queryTerms.join(' ');
  if (queryPhrase.length > 4 && content.includes(queryPhrase)) {
    phraseBonus = 0.3;
  }

  // Partial phrase matching (bigrams)
  for (let i = 0; i < queryTerms.length - 1; i++) {
    const bigram = `${queryTerms[i]} ${queryTerms[i + 1]}`;
    if (content.includes(bigram)) phraseBonus += 0.1;
  }

  const termCoverage = matchCount / queryTerms.length;
  return Math.min(1, termCoverage + phraseBonus);
}

// ── Entity scoring ─────────────────────────────────────────────────────────

function computeEntityScore(
  queryEntities: string[],
  queryLower: string,
  senderLower: string,
  chatLower: string,
): number {
  let score = 0;

  // Direct sender/chat mention in query
  if (senderLower && senderLower.length > 2 && queryLower.includes(senderLower)) {
    score += 0.5;
  }
  if (chatLower && chatLower.length > 2 && queryLower.includes(chatLower)) {
    score += 0.5;
  }

  // Entity overlap
  for (const entity of queryEntities) {
    if (senderLower.includes(entity) || chatLower.includes(entity)) {
      score += 0.3;
    }
  }

  return Math.min(1, score);
}

// ── Content quality scoring ────────────────────────────────────────────────

function computeQualityScore(content: string, messageType: string): number {
  const len = content.length;

  // Prefer messages with substantial content
  let lengthScore: number;
  if (len < 10) lengthScore = 0.1;
  else if (len < 30) lengthScore = 0.4;
  else if (len < 200) lengthScore = 0.8;
  else if (len < 500) lengthScore = 1.0;
  else if (len < 1000) lengthScore = 0.9;
  else lengthScore = 0.7;

  // Bonus for document/media types (they often have richer content)
  let typeBonus = 0;
  if (messageType === 'document' || messageType === 'image') typeBonus = 0.1;

  return Math.min(1, lengthScore + typeBonus);
}

// ── Utilities ──────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'about', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'between', 'under',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than',
  'too', 'very', 'just', 'because', 'as', 'until', 'while', 'that',
  'which', 'who', 'whom', 'what', 'when', 'where', 'why', 'how',
  'this', 'those', 'these', 'i', 'me', 'my', 'we', 'our', 'you',
  'your', 'he', 'him', 'his', 'she', 'her', 'it', 'its', 'they', 'them', 'their',
  'show', 'find', 'get', 'tell', 'give', 'search', 'look', 'messages',
]);

function extractTerms(text: string): string[] {
  return text
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w));
}

function extractEntities(text: string): string[] {
  // Simple entity extraction: words that start with uppercase in original
  // or multi-word capitalized phrases
  const words = text.split(/\s+/).filter(w => w.length >= 2 && !STOP_WORDS.has(w));
  return words.filter(w => /^[A-Z]/.test(w) || w.length > 3);
}

function normalizeScore(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export default { rerank };
