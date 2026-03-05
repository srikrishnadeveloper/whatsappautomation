/**
 * Response Cache Service
 *
 * Caches AI responses for repeated or similar queries to reduce latency
 * and API costs. Uses both in-memory LRU cache and Supabase persistence.
 *
 * Cache strategy:
 *  - Key = MD5(normalized_query + userId)
 *  - TTL = 10 minutes for most queries, 5 minutes for time-sensitive ones
 *  - Max in-memory entries = 200
 *  - Supabase table: ai_response_cache (for persistence across restarts)
 */

import { createHash } from 'crypto';
import { getSupabaseClient } from '../config/supabase';
import log from './activity-log';

// ── Types ───────────────────────────────────────────────────────────────────

interface CacheEntry {
  query: string;
  response: any;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
}

// ── Config ──────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 10 * 60 * 1000;       // 10 minutes
const TIME_SENSITIVE_TTL_MS = 5 * 60 * 1000;  // 5 minutes for "today", "now" queries
const MAX_CACHE_SIZE = 200;

// ── In-memory LRU cache ────────────────────────────────────────────────────

const memoryCache = new Map<string, CacheEntry>();

// ── Cache key generation ────────────────────────────────────────────────────

function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateCacheKey(query: string, userId: string): string {
  const normalized = normalizeQuery(query);
  return createHash('md5').update(`${userId}:${normalized}`).digest('hex');
}

function isTimeSensitive(query: string): boolean {
  return /\b(today|now|right now|just|latest|current|this morning|tonight|recent)\b/i.test(query);
}

// ── Get from cache ──────────────────────────────────────────────────────────

export async function getCachedResponse(query: string, userId: string): Promise<any | null> {
  const key = generateCacheKey(query, userId);
  const now = Date.now();

  // 1. Check in-memory cache first
  const memEntry = memoryCache.get(key);
  if (memEntry && memEntry.expiresAt > now) {
    memEntry.hitCount++;
    return memEntry.response;
  }

  // 2. Evict expired memory entry
  if (memEntry) memoryCache.delete(key);

  // 3. Check Supabase cache
  try {
    const db = getSupabaseClient();
    const { data, error } = await db
      .from('ai_response_cache')
      .select('response, expires_at, hit_count')
      .eq('cache_key', key)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !data) return null;

    // Promote to memory cache
    const expiresAt = new Date(data.expires_at).getTime();
    memoryCache.set(key, {
      query,
      response: data.response,
      createdAt: now,
      expiresAt,
      hitCount: data.hit_count + 1,
    });
    enforceMaxSize();

    // Update hit count in DB (fire-and-forget)
    (db.from('ai_response_cache')
      .update({ hit_count: data.hit_count + 1 })
      .eq('cache_key', key) as any as Promise<any>)
      .then(() => {})
      .catch(() => {});

    return data.response;
  } catch (err: any) {
    // Cache miss or DB error — not critical
    return null;
  }
}

// ── Store in cache ──────────────────────────────────────────────────────────

export async function setCachedResponse(
  query: string,
  userId: string,
  response: any,
): Promise<void> {
  const key = generateCacheKey(query, userId);
  const now = Date.now();
  const ttl = isTimeSensitive(query) ? TIME_SENSITIVE_TTL_MS : DEFAULT_TTL_MS;
  const expiresAt = now + ttl;

  // 1. Store in memory
  memoryCache.set(key, {
    query,
    response,
    createdAt: now,
    expiresAt,
    hitCount: 0,
  });
  enforceMaxSize();

  // 2. Persist to Supabase (fire-and-forget)
  try {
    const db = getSupabaseClient();
    await db
      .from('ai_response_cache')
      .upsert({
        cache_key: key,
        query,
        response,
        user_id: userId,
        expires_at: new Date(expiresAt).toISOString(),
        hit_count: 0,
      }, { onConflict: 'cache_key' });
  } catch (err: any) {
    // Non-critical — memory cache is primary
    log.error('Cache persist failed', err.message);
  }
}

// ── Invalidate cache ────────────────────────────────────────────────────────

export async function invalidateCache(userId: string): Promise<void> {
  // Clear memory entries for this user (we can't filter easily, so clear all)
  memoryCache.clear();

  try {
    const db = getSupabaseClient();
    await db
      .from('ai_response_cache')
      .delete()
      .eq('user_id', userId);
  } catch (err: any) {
    log.error('Cache invalidation failed', err.message);
  }
}

// ── Cleanup expired entries ─────────────────────────────────────────────────

export async function cleanupExpiredCache(): Promise<number> {
  const now = Date.now();
  let removed = 0;

  // Clean memory
  for (const [key, entry] of memoryCache) {
    if (entry.expiresAt <= now) {
      memoryCache.delete(key);
      removed++;
    }
  }

  // Clean DB
  try {
    const db = getSupabaseClient();
    await db
      .from('ai_response_cache')
      .delete()
      .lt('expires_at', new Date().toISOString());
  } catch (err: any) {
    log.error('Cache cleanup failed', err.message);
  }

  return removed;
}

// ── LRU enforcement ────────────────────────────────────────────────────────

function enforceMaxSize(): void {
  if (memoryCache.size <= MAX_CACHE_SIZE) return;

  // Remove oldest entries
  const entries = Array.from(memoryCache.entries())
    .sort((a, b) => a[1].createdAt - b[1].createdAt);

  const toRemove = entries.slice(0, memoryCache.size - MAX_CACHE_SIZE);
  for (const [key] of toRemove) {
    memoryCache.delete(key);
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────

export function getCacheStats() {
  return {
    memoryCacheSize: memoryCache.size,
    maxSize: MAX_CACHE_SIZE,
    defaultTtlMinutes: DEFAULT_TTL_MS / 60000,
  };
}

// Run cleanup every 5 minutes
setInterval(() => {
  cleanupExpiredCache().catch(() => {});
}, 5 * 60 * 1000);
