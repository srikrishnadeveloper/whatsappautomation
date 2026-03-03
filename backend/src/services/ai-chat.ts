/**
 * AI Chat Service — Conversational AI over WhatsApp & Gmail messages
 *
 * Features:
 *  - Multi-turn conversation with memory (50 turns per user)
 *  - Dynamic model selection: user picks or auto-selects
 *  - Task management: create / complete / delete tasks via chat
 *  - Privacy-aware: never exposes messages from blocked senders
 *  - Auto-retry on AI failures (up to 2 retries)
 *  - Corrupted document content filtering
 *  - Source citations with full media references
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { randomUUID } from 'crypto';
import log from './activity-log';
import { supabase } from '../config/supabase';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;

let genAI: GoogleGenerativeAI | null = null;

// ── Supported models ────────────────────────────────────────────────────────

export const AVAILABLE_MODELS = [
  { id: 'gemini-2.5-pro',       label: 'Gemini 2.5 Pro',        tier: 'premium' },
  { id: 'gemini-2.5-flash',     label: 'Gemini 2.5 Flash',      tier: 'fast'    },
  { id: 'gemini-2.0-flash',     label: 'Gemini 2.0 Flash',      tier: 'fast'    },
  { id: 'gemini-2.0-flash-lite',label: 'Gemini 2.0 Flash Lite', tier: 'fast'    },
] as const;

export type ModelId = typeof AVAILABLE_MODELS[number]['id'];

const DEFAULT_MODEL: ModelId = 'gemini-2.5-flash';

// Per-user model preference: userId → modelId
const userModelPrefs = new Map<string, ModelId>();

export function setUserModel(userId: string, modelId: string): boolean {
  if (!AVAILABLE_MODELS.some(m => m.id === modelId)) return false;
  userModelPrefs.set(userId, modelId as ModelId);
  return true;
}

export function getUserModel(userId: string): ModelId {
  return userModelPrefs.get(userId) || DEFAULT_MODEL;
}

function getModelInstance(modelId: ModelId) {
  if (!genAI) return null;
  return genAI.getGenerativeModel({ model: modelId });
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: ChatSource[];
  suggestions?: string[];
  stats?: { messagesSearched: number; sourcesFound: number };
  /** Which model produced this response */
  model?: string;
  /** If we retried, how many attempts */
  retryCount?: number;
  /** Task action the AI performed */
  taskAction?: TaskActionResult;
}

export interface ChatSource {
  messageId: string;
  sender: string;
  chatName: string;
  content: string;
  timestamp: string;
  matchReason: string;
  mediaType?: string | null;
  messageKey?: string | null;
  hasMedia?: boolean;
  documentName?: string | null;
  imageDescription?: string | null;
  documentSummary?: string | null;
}

export interface ChatResponse {
  message: ChatMessage;
  conversationId: string;
  sessionId: string;
  sessionTitle?: string;
}

export interface SessionMeta {
  sessionId: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messageCount: number;
}

export interface TaskActionResult {
  action: 'created' | 'completed' | 'deleted' | 'listed' | 'none';
  taskId?: string;
  taskTitle?: string;
  error?: string;
}

interface MessageData {
  id: string;
  sender: string;
  chat_name: string | null;
  content: string;
  timestamp: string;
  classification?: string | null;
  metadata?: any;
}

// ── Session store ──────────────────────────────────────────────────────────

const MAX_HISTORY = 60;
const MAX_SESSIONS_PER_USER = 50;

// sessionId → ChatMessage[]
const conversationStore = new Map<string, ChatMessage[]>();
// sessionId → SessionMeta
const sessionMetaStore  = new Map<string, SessionMeta>();
// userId → sessionId[] (newest first)
const userSessionsStore = new Map<string, string[]>();
// sessionId → messages pushed since last DB persist
const pendingPushCount  = new Map<string, number>();

function makeTitleFromMessage(msg: string): string {
  const clean = msg.trim().replace(/\s+/g, ' ');
  const words = clean.split(' ');
  return words.slice(0, 6).join(' ').slice(0, 50) + (words.length > 6 ? '…' : '');
}

// ── Session management ─────────────────────────────────────────────────────

export function createSession(userId: string, title = 'New Chat'): SessionMeta {
  const sessionId = randomUUID();
  const now = new Date().toISOString();
  const meta: SessionMeta = { sessionId, userId, title, createdAt: now, updatedAt: now, lastMessageAt: now, messageCount: 0 };
  sessionMetaStore.set(sessionId, meta);
  conversationStore.set(sessionId, []);
  if (!userSessionsStore.has(userId)) userSessionsStore.set(userId, []);
  userSessionsStore.get(userId)!.unshift(sessionId);
  persistSession(sessionId, userId, title, []);
  return meta;
}

export function listSessions(userId: string): SessionMeta[] {
  return (userSessionsStore.get(userId) || [])
    .map(id => sessionMetaStore.get(id))
    .filter(Boolean) as SessionMeta[];
}

export async function listSessionsFromDb(userId: string): Promise<SessionMeta[]> {
  if (!supabase) return listSessions(userId);
  try {
    const { data } = await supabase
      .from('ai_chat_history')
      .select('session_id,title,created_at,updated_at,last_message_at,messages')
      .eq('user_id', userId)
      .order('last_message_at', { ascending: false })
      .limit(MAX_SESSIONS_PER_USER);
    if (!data) return listSessions(userId);

    // Merge DB results with in-memory store
    const dbSessionIds = new Set<string>();
    const result: SessionMeta[] = [];
    for (const row of data) {
      dbSessionIds.add(row.session_id);
      const msgs: ChatMessage[] = Array.isArray(row.messages) ? row.messages : [];
      const meta: SessionMeta = {
        sessionId: row.session_id,
        userId,
        title: row.title || 'New Chat',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastMessageAt: row.last_message_at || row.updated_at,
        messageCount: msgs.length,
      };
      // Hydrate in-memory cache if not already present
      if (!sessionMetaStore.has(row.session_id)) {
        sessionMetaStore.set(row.session_id, meta);
        conversationStore.set(row.session_id, msgs.slice(-MAX_HISTORY));
        if (!userSessionsStore.has(userId)) userSessionsStore.set(userId, []);
        const arr = userSessionsStore.get(userId)!;
        if (!arr.includes(row.session_id)) arr.push(row.session_id);
      } else {
        // Use in-memory meta (may be more recent than DB)
        const memMeta = sessionMetaStore.get(row.session_id)!;
        result.push(memMeta);
        continue;
      }
      result.push(meta);
    }
    // Also include any in-memory sessions not yet in DB (just created)
    const memSessions = listSessions(userId);
    for (const ms of memSessions) {
      if (!dbSessionIds.has(ms.sessionId)) result.unshift(ms);
    }
    return result;
  } catch { return listSessions(userId); }
}

export async function deleteSession(sessionId: string, userId?: string): Promise<boolean> {
  const meta = sessionMetaStore.get(sessionId);
  // Ownership check: if userId is provided, verify the session belongs to this user
  if (userId && meta && meta.userId !== userId) return false;
  conversationStore.delete(sessionId);
  sessionMetaStore.delete(sessionId);
  if (meta) {
    const arr = userSessionsStore.get(meta.userId) || [];
    userSessionsStore.set(meta.userId, arr.filter(id => id !== sessionId));
  }
  if (!supabase) return true;
  try {
    await supabase
      .from('ai_chat_history')
      .delete()
      .eq('session_id', sessionId)
      .eq('user_id', userId ?? '');
  } catch {}
  return true;
}

export function renameSession(sessionId: string, title: string, userId?: string): boolean {
  const meta = sessionMetaStore.get(sessionId);
  if (!meta) return false;
  // Ownership check
  if (userId && meta.userId !== userId) return false;
  meta.title = title;
  // Use lightweight rename — does NOT update last_message_at so renamed sessions
  // stay at their natural position in the list (not promoted to top).
  persistRename(sessionId, meta.userId, title);
  return true;
}

// ── History helpers ────────────────────────────────────────────────────────

/** Load a session's history from Supabase (lazy, once per sessionId) */
export async function ensureChatHistoryLoaded(sessionId: string, userId?: string): Promise<void> {
  if (conversationStore.has(sessionId)) return;
  if (!supabase) { conversationStore.set(sessionId, []); return; }
  try {
    const { data } = await supabase
      .from('ai_chat_history')
      .select('messages,title,user_id,created_at,updated_at,last_message_at')
      .eq('session_id', sessionId)
      .maybeSingle();
    if (data) {
      const msgs: ChatMessage[] = Array.isArray(data.messages) ? data.messages.slice(-MAX_HISTORY) : [];
      conversationStore.set(sessionId, msgs);
      sessionMetaStore.set(sessionId, {
        sessionId,
        userId: data.user_id || userId || '',
        title: data.title || 'New Chat',
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        lastMessageAt: data.last_message_at || data.updated_at,
        messageCount: msgs.length,
      });
    } else {
      conversationStore.set(sessionId, []);
    }
  } catch { conversationStore.set(sessionId, []); }
}

function persistSession(sessionId: string, userId: string, title: string, messages: ChatMessage[]): void {
  if (!supabase) return;
  const now = new Date().toISOString();
  Promise.resolve(
    supabase.from('ai_chat_history').upsert({
      session_id: sessionId, user_id: userId, title, messages,
      updated_at: now, last_message_at: now,
    }, { onConflict: 'session_id' })
  ).then(() => {}).catch((err) => {
    log.error('persistSession failed', `session=${sessionId} error=${err?.message || err}`);
  });
}

/** Lightweight rename: updates title & updated_at only — does NOT touch last_message_at */
function persistRename(sessionId: string, userId: string, title: string): void {
  if (!supabase) return;
  const now = new Date().toISOString();
  Promise.resolve(
    supabase.from('ai_chat_history')
      .update({ title, updated_at: now })
      .eq('session_id', sessionId)
      .eq('user_id', userId)
  ).then(() => {}).catch((err) => {
    log.error('persistRename failed', `session=${sessionId} error=${err?.message || err}`);
  });
}

function getHistory(sessionId: string): ChatMessage[] {
  if (!conversationStore.has(sessionId)) conversationStore.set(sessionId, []);
  return conversationStore.get(sessionId)!;
}

function pushMessage(sessionId: string, msg: ChatMessage, userId: string): void {
  const history = getHistory(sessionId);
  history.push(msg);
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);

  const meta = sessionMetaStore.get(sessionId);
  const isFirstUserMsg = msg.role === 'user' && history.filter(m => m.role === 'user').length === 1;
  const title = (meta?.title && meta.title !== 'New Chat')
    ? meta.title
    : isFirstUserMsg ? makeTitleFromMessage(msg.content) : (meta?.title || 'New Chat');

  if (meta) {
    meta.title = title;
    meta.updatedAt = msg.timestamp;
    meta.lastMessageAt = msg.timestamp;
    meta.messageCount = history.length;
  }

  // D3: Only persist to DB on assistant messages (each turn = user+assistant → one write per turn).
  // Always persist the first user message so a new session appears in DB immediately.
  const count = (pendingPushCount.get(sessionId) || 0) + 1;
  pendingPushCount.set(sessionId, count);
  if (msg.role === 'assistant' || isFirstUserMsg) {
    pendingPushCount.set(sessionId, 0);
    persistSession(sessionId, userId, title, history);
  }
}

export function getChatHistory(sessionId: string): ChatMessage[] {
  return getHistory(sessionId);
}

export async function clearChatHistory(sessionId: string): Promise<void> {
  conversationStore.delete(sessionId);
  const meta = sessionMetaStore.get(sessionId);
  if (meta) { meta.messageCount = 0; meta.title = 'New Chat'; }
  if (!supabase) return;
  try {
    await supabase.from('ai_chat_history')
      .update({ messages: [], title: 'New Chat', updated_at: new Date().toISOString() })
      .eq('session_id', sessionId);
  } catch {}
}

// ── Initialization ──────────────────────────────────────────────────────────

export function initChatAI(): boolean {
  if (!GEMINI_API_KEY) {
    log.warning('Gemini API key not found', 'AI Chat disabled');
    return false;
  }
  try {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    log.success('AI Chat initialized', `Models: ${AVAILABLE_MODELS.map(m => m.id).join(', ')}`);
    return true;
  } catch (error: any) {
    log.error('Failed to initialize AI Chat', error.message);
    return false;
  }
}

// ── Sync keyword extraction ────────────────────────────────────────────────

const AI_STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','can',
  'to','of','in','for','on','with','at','by','from','as','into','through','during',
  'before','after','above','below','between','out','off','over','under','again',
  'further','then','once','here','there','when','where','why','how','all','each',
  'every','both','few','more','most','other','some','such','no','nor','not','only',
  'own','same','so','than','too','very','just','because','but','and','or','if',
  'while','about','what','which','who','whom','this','that','these','those','am',
  'it','its','my','your','his','her','our','their','me','him','us','them','i',
  'you','he','she','we','they','tell','show','find','get','give','bring','make',
  'know','take','see','look','think','want','need','use','try','ask','say','also',
  'well','much','many','like','please','help','let','still','really','actually',
  'anything','everything','something','nothing','recent','going',
]);

function extractKeywordsSync(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !AI_STOP_WORDS.has(w));
}

// ── Date-aware query detection ───────────────────────────────────────────────

interface DateRange { dateFrom: string; dateTo: string; }

function detectDateQuery(query: string): DateRange | null {
  const q = query.toLowerCase();
  const now = new Date();

  if (/\btoday\b/.test(q)) {
    const s = new Date(now); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { dateFrom: s.toISOString(), dateTo: e.toISOString() };
  }
  if (/\byesterday\b/.test(q)) {
    const d = new Date(now); d.setDate(d.getDate() - 1);
    const s = new Date(d); s.setHours(0, 0, 0, 0);
    const e = new Date(d); e.setHours(23, 59, 59, 999);
    return { dateFrom: s.toISOString(), dateTo: e.toISOString() };
  }
  if (/\bthis\s+week\b/.test(q)) {
    const day = now.getDay();
    const s = new Date(now); s.setDate(now.getDate() - day); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { dateFrom: s.toISOString(), dateTo: e.toISOString() };
  }
  if (/\blast\s+week\b/.test(q)) {
    const day = now.getDay();
    const e = new Date(now); e.setDate(now.getDate() - day - 1); e.setHours(23, 59, 59, 999);
    const s = new Date(e); s.setDate(e.getDate() - 6); s.setHours(0, 0, 0, 0);
    return { dateFrom: s.toISOString(), dateTo: e.toISOString() };
  }
  if (/\bthis\s+month\b/.test(q)) {
    const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { dateFrom: s.toISOString(), dateTo: e.toISOString() };
  }
  const lastN = q.match(/\blast\s+(\d+)\s+days?\b/);
  if (lastN) {
    const n = parseInt(lastN[1], 10);
    const s = new Date(now); s.setDate(now.getDate() - n); s.setHours(0, 0, 0, 0);
    const e = new Date(now); e.setHours(23, 59, 59, 999);
    return { dateFrom: s.toISOString(), dateTo: e.toISOString() };
  }
  return null;
}

export { detectDateQuery };
export type { DateRange };

// ── Content cleaning: filter corrupted/binary doc content ───────────────────

const CORRUPTED_PATTERNS = [
  /appears?\s+to\s+be\s+a?\s*corrupted/i,
  /unreadable\s+(word|pdf|document|file)/i,
  /consists?\s+of\s+binary\s+data/i,
  /not\s+directly\s+interpretable\s+as\s+text/i,
  /no\s+extractable\s+key\s+text/i,
  /binary\s+data\s+and\s+xml\s+structures/i,
  /content\s+consists?\s+of\s+binary/i,
  /PK[\x00-\x09]/,
  /[\x00-\x08\x0E-\x1F]{5,}/,
];

function isCorruptedContent(text: string): boolean {
  return CORRUPTED_PATTERNS.some(p => p.test(text));
}

function cleanMessageContent(msg: MessageData): MessageData {
  let content = msg.content;
  // If the content is a corrupted-doc description, replace with just the filename
  if (isCorruptedContent(content)) {
    const fileName = msg.metadata?.document?.fileName;
    content = fileName
      ? `[Document: ${fileName}] (content not extractable)`
      : '[Document received — content not extractable]';
  }
  // Clean metadata too
  if (msg.metadata?.documentAnalysis?.summary && isCorruptedContent(msg.metadata.documentAnalysis.summary)) {
    msg = {
      ...msg,
      metadata: {
        ...msg.metadata,
        documentAnalysis: {
          ...msg.metadata.documentAnalysis,
          summary: 'Document content could not be extracted.',
        },
      },
    };
  }
  return { ...msg, content };
}

// ── Task intent detection ───────────────────────────────────────────────────

interface TaskIntent {
  action: 'create' | 'complete' | 'delete' | 'list' | 'none';
  title?: string;
  priority?: string;
  category?: string;
  taskId?: string;
  searchTerm?: string;
}

function detectTaskIntent(query: string): TaskIntent {
  const q = query.toLowerCase().trim();

  // Create
  if (/^(create|add|make|new)\s+(a\s+)?(task|todo|to-do|action\s*item)/i.test(q)) {
    // Extract the title after "create task ..."
    const titleMatch = query.match(/(?:create|add|make|new)\s+(?:a\s+)?(?:task|todo|to-do|action\s*item)\s*[:\-—]?\s*(.+)/i);
    const title = titleMatch?.[1]?.trim();
    const priority = /urgent/i.test(q) ? 'urgent' : /high/i.test(q) ? 'high' : /low/i.test(q) ? 'low' : 'medium';
    const category = /work/i.test(q) ? 'work' : /study/i.test(q) ? 'study' : /personal/i.test(q) ? 'personal' : 'other';
    return { action: 'create', title, priority, category };
  }

  // Complete
  if (/^(complete|finish|done|mark\s+(as\s+)?(done|complete|finished))\s/i.test(q)) {
    const term = query.replace(/^(complete|finish|done|mark\s+(as\s+)?(done|complete|finished))\s*/i, '').trim();
    return { action: 'complete', searchTerm: term };
  }

  // Delete
  if (/^(delete|remove|cancel)\s+(the\s+)?(task|todo|to-do|action\s*item)/i.test(q)) {
    const term = query.replace(/^(delete|remove|cancel)\s+(the\s+)?(task|todo|to-do|action\s*item)\s*/i, '').trim();
    return { action: 'delete', searchTerm: term };
  }

  // List
  if (/^(list|show|view|get)\s+(all\s+)?(my\s+)?(tasks|todos|to-dos|action\s*items)/i.test(q)) {
    return { action: 'list' };
  }

  return { action: 'none' };
}

// ── Pre-filter ──────────────────────────────────────────────────────────────

/**
 * PASS 1 — Ask Gemini to extract search keywords from the user query.
 * Returns an array of keywords Gemini thinks are most useful to search for.
 * Uses the cheapest/fastest model (flash-lite) to keep latency low.
 */
async function extractKeywordsWithGemini(query: string, model: any): Promise<string[]> {
  try {
    const prompt = `Extract the most important search keywords from this user question. Return ONLY a JSON array of lowercase strings (no explanation, no markdown). Include synonyms and related terms. Max 10 keywords.

User question: "${query}"

Example output: ["project", "report", "deadline", "submit"]`;
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const match = text.match(/\[.*\]/s);
    if (!match) return query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const keywords: string[] = JSON.parse(match[0]);
    return keywords.filter(k => typeof k === 'string' && k.length > 1);
  } catch {
    // Fallback: just split the query
    return query.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  }
}

/**
 * PASS 1 filter — search all messages for keyword matches, return top hits.
 * Optionally pre-filters by a date range before keyword matching.
 */
function searchByKeywords(keywords: string[], messages: MessageData[], limit = 300, dateRange?: DateRange | null): MessageData[] {
  // Pre-filter by date range if provided (B5/E11 fix)
  const pool = dateRange ? (() => {
    const from = new Date(dateRange.dateFrom).getTime();
    const to   = new Date(dateRange.dateTo).getTime();
    return messages.filter(m => {
      const t = new Date(m.timestamp).getTime();
      return t >= from && t <= to;
    });
  })() : messages;

  if (keywords.length === 0) return pool.slice(-limit);

  const results: Array<{ msg: MessageData; hits: number }> = [];
  for (const m of pool) {
    const blob = [
      m.sender, m.chat_name ?? '', m.content,
      m.metadata?.document?.fileName ?? '',
      m.metadata?.imageAnalysis?.description ?? '',
      m.metadata?.imageAnalysis?.extractedText ?? '',
      m.metadata?.documentAnalysis?.summary ?? '',
      m.metadata?.documentAnalysis?.topics?.join(' ') ?? '',
    ].join(' ').toLowerCase();

    let hits = 0;
    for (const kw of keywords) {
      if (blob.includes(kw)) hits++;
    }
    if (hits > 0) results.push({ msg: m, hits });
  }

  // Sort by hit count desc, then by recency for ties
  results.sort((a, b) =>
    b.hits !== a.hits
      ? b.hits - a.hits
      : new Date(b.msg.timestamp).getTime() - new Date(a.msg.timestamp).getTime()
  );

  const top = results.slice(0, limit).map(r => r.msg);

  // If we got fewer than 30 hits, pad with the most recent messages so AI
  // always has some context (handles brand-new messages not yet indexed)
  if (top.length < 30 && !dateRange) {
    const topIds = new Set(top.map(m => m.id));
    const recent = pool
      .slice()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .filter(m => !topIds.has(m.id))
      .slice(0, 30 - top.length);
    top.push(...recent);
  }

  // Always return oldest→newest so Gemini reads in time order
  top.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return top;
}

// ── Build message context ───────────────────────────────────────────────────

function fmtTs(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) +
      ' at ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch { return ts.slice(0, 16); }
}

/** human-readable relative age: "just now", "2 hours ago", "3 days ago", etc. */
function fmtRelative(ts: string): string {
  try {
    const diffMs = Date.now() - new Date(ts).getTime();
    if (diffMs < 0) return 'just now';
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 2)  return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7)  return `${days} day${days > 1 ? 's' : ''} ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    const months = Math.floor(days / 30);
    return `${months} month${months > 1 ? 's' : ''} ago`;
  } catch { return ''; }
}

function buildMessageContext(messages: MessageData[]): string {
  return messages.map((m, i) => {
    const ts = fmtTs(m.timestamp);
    const rel = fmtRelative(m.timestamp);
    const mediaType = m.metadata?.mediaType;
    let line = `[${i}] FROM:${m.sender} CHAT:${m.chat_name || '?'} TIME:${ts} (${rel})`;
    if (mediaType) line += ` TYPE:${mediaType.toUpperCase()}`;

    // Show full content (not truncated for short messages)
    const contentDisplay = m.content.length > 700 ? m.content.slice(0, 700) + '…' : m.content;
    line += `\nCONTENT: ${contentDisplay}`;

    // Document filename — very important for file queries
    if (m.metadata?.document?.fileName) {
      line += `\nFILE: ${m.metadata.document.fileName} (${m.metadata?.document?.mimeType || 'unknown type'})`;
      if (m.metadata?.document?.fileSize) line += ` size:${Math.round(m.metadata.document.fileSize/1024)}KB`;
    }
    // Image analysis
    if (m.metadata?.imageAnalysis?.description) {
      line += `\nIMAGE_DESC: ${m.metadata.imageAnalysis.description.slice(0, 300)}`;
    }
    if (m.metadata?.imageAnalysis?.extractedText) {
      line += `\nIMAGE_TEXT: ${m.metadata.imageAnalysis.extractedText.slice(0, 300)}`;
    }
    // Document analysis
    if (m.metadata?.documentAnalysis?.summary && !isCorruptedContent(m.metadata.documentAnalysis.summary)) {
      line += `\nDOC_SUMMARY: ${m.metadata.documentAnalysis.summary.slice(0, 400)}`;
    }
    if (m.metadata?.documentAnalysis?.topics?.length) {
      line += `\nDOC_TOPICS: ${m.metadata.documentAnalysis.topics.slice(0, 5).join(', ')}`;
    }
    return line;
  }).join('\n---\n');
}

// ── Build prompt ────────────────────────────────────────────────────────────

function buildConversationPrompt(
  userQuery: string,
  history: ChatMessage[],
  messageContext: string,
  candidateCount: number,
  totalMessages: number
): string {
  // Keep last 16 turns for better follow-up context (B1 fix)
  const recentHistory = history.slice(-16);

  // IMPORTANT: Strip verbose content from AI responses in history.
  // AI responses quote inbox messages — if we send them back verbatim the AI can
  // mistake stale recycled quotes for fresh inbox data → message confusion.
  let conversationSection = '';
  if (recentHistory.length > 0) {
    const histLines = recentHistory.map(h => {
      if (h.role === 'user') {
        return `USER_ASKED: ${h.content.slice(0, 500)}`;
      } else {
        // For AI turns: 500 chars to preserve enough context for follow-up questions (B1 fix)
        const brief = h.content.replace(/\*\*/g, '').slice(0, 500);
        return `AI_REPLIED: ${brief}${h.content.length > 500 ? '...' : ''}`;
      }
    }).join('\n');
    conversationSection =
      '\nPRIOR CONVERSATION TURNS (for follow-up context ONLY — these are NOT inbox messages):\n' +
      histLines + '\n';
  }

  return `You are Mindline AI — a precise assistant that searches the user's WhatsApp and Gmail inbox.
Today: ${new Date().toISOString().slice(0, 10)}
Total messages in DB: ${totalMessages} | Messages given to you now: ${candidateCount}
${conversationSection}
${'='.repeat(60)}
INBOX MESSAGES (sorted oldest to newest — entries near the end are MORE RECENT)
Format: [index] FROM:sender CHAT:group TIME:absolute (RELATIVE_AGE)
${'='.repeat(60)}
${messageContext}
${'='.repeat(60)}
END OF INBOX DATA
${'='.repeat(60)}

USER QUERY: "${userQuery}"

CRITICAL RULES:
1. The INBOX MESSAGES section above is the ONLY source of truth. PRIOR CONVERSATION TURNS is background only — do NOT treat prior AI replies as inbox data.
2. Time awareness: entries showing "just now" / "X min ago" / "X hours ago" are RECENT. Entries showing "X days/weeks/months ago" are OLD. Always note the relative age when answering.
3. For "recent" or "latest" queries: prioritise entries with the smallest relative age values (bottom of the list = newest).
4. For specific file/entity queries: search ALL entries for FILE, CONTENT, IMAGE_DESC, DOC_TOPICS fields.
5. For file/document queries: list every FILE entry — bold the filename, state sender and relative age.
6. NEVER say "I couldn't find" if matching FILE or CONTENT entries exist above.
7. Cite sender + chat + relative time for every finding.
8. If a document's content wasn't extracted, still report: filename, sender, time.
9. Do NOT reproduce corrupted/binary content.
10. Use bullet points, bold names and filenames.

Respond in this exact JSON (no text outside the JSON):
{
  "reply": "Detailed markdown answer. Bold sender names and filenames. Note relative time for every item. Mention senders by name when citing their messages.",
  "suggestions": ["4 specific follow-up questions based on what was found"]
}`;  // B3: sourceIndices removed — match-based sources computed after reply
}

// ── Main chat function ──────────────────────────────────────────────────────

let messageIdCounter = 0;
function genId(): string { return `chat-${Date.now()}-${++messageIdCounter}`; }

export { detectTaskIntent };
export type { TaskIntent };

export async function chat(
  userQuery: string,
  messages: MessageData[],
  userId: string,
  sessionId: string,
  totalInDb: number = 0,
  modelOverride?: ModelId
): Promise<ChatResponse> {
  if (!genAI) initChatAI();

  const totalMessages = totalInDb || messages.length;
  const modelId = modelOverride || getUserModel(userId);

  // 1. Store user message
  const userMsg: ChatMessage = {
    id: genId(),
    role: 'user',
    content: userQuery,
    timestamp: new Date().toISOString(),
  };
  pushMessage(sessionId, userMsg, userId);

  // 2. Clean all messages (filter corrupted content)
  const cleanedMessages = messages.map(cleanMessageContent);

  // 3. SINGLE-PASS SEARCH (B4/D4 fix: removed Gemini pre-call to halve latency)
  //    Extract keywords synchronously, detect date range, then search messages.
  const keywords = extractKeywordsSync(userQuery);
  const dateRange = detectDateQuery(userQuery);
  log.info('Keyword extraction (sync)', `query="${userQuery.slice(0,40)}" → [${keywords.join(', ')}]${dateRange ? ` DATE:${dateRange.dateFrom.slice(0,10)}→${dateRange.dateTo.slice(0,10)}` : ''}`);

  let candidates: MessageData[];
  if (keywords.length > 0 || dateRange) {
    candidates = searchByKeywords(keywords, cleanedMessages, 300, dateRange);
  } else {
    // No keywords — fall back to most recent 300 messages
    candidates = cleanedMessages
      .slice()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 300)
      .reverse();
  }

  // 4. If no AI available, return a basic response
  const model = getModelInstance(modelId);
  if (!model) {
    const fallbackMsg: ChatMessage = {
      id: genId(),
      role: 'assistant',
      content: candidates.length > 0
        ? `I found **${candidates.length}** messages matching your query, but AI is currently unavailable. Top matches:\n\n${candidates.slice(0, 5).map(m => `- **${m.sender}**: "${m.content.slice(0, 100)}…"`).join('\n')}`
        : `I couldn't find messages matching "${userQuery}". Try different keywords.`,
      timestamp: new Date().toISOString(),
      sources: candidates.slice(0, 5).map(m => buildSource(m, 'Keyword match')),
      suggestions: ['Show all my messages', 'Find recent tasks', 'Summarize today\'s messages'],
      stats: { messagesSearched: totalMessages, sourcesFound: candidates.length },
      model: modelId,
    };
    pushMessage(sessionId, fallbackMsg, userId);
    const fallbackTitle = sessionMetaStore.get(sessionId)?.title;
    return { message: fallbackMsg, conversationId: sessionId, sessionId, sessionTitle: fallbackTitle };
  }

  // 5. Attempt AI generation with auto-retry
  const MAX_RETRIES = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const messageContext = buildMessageContext(candidates);
      const history = getHistory(sessionId);
      const prompt = buildConversationPrompt(userQuery, history.slice(0, -1), messageContext, candidates.length, totalMessages);

      // Use a different model on retry if premium fails
      const retryModelId = attempt > 0
        ? (modelId === 'gemini-2.5-pro' ? 'gemini-2.5-flash' as ModelId : 'gemini-2.0-flash' as ModelId)
        : modelId;
      const activeModel = attempt > 0 ? getModelInstance(retryModelId) || model : model;

      const result = await activeModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Parse JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Could not parse AI response as JSON');
      const parsed = JSON.parse(jsonMatch[0]);

      // B3: Match-based sources — find candidates whose sender/chat name appears in the reply
      // This is reliable because the AI is instructed to name senders when citing messages.
      const replyLower = (parsed.reply || '').toLowerCase();
      const seenSourceIds = new Set<string>();
      const sources: ChatSource[] = candidates
        .filter(m => {
          const senderLower = (m.sender || '').toLowerCase();
          const chatLower   = (m.chat_name || '').toLowerCase();
          return (senderLower.length > 2 && replyLower.includes(senderLower)) ||
                 (chatLower.length   > 2 && replyLower.includes(chatLower));
        })
        .slice(0, 8)
        .map(m => buildSource(m, 'Mentioned in response'))
        .filter(s => {
          const key = s.messageKey || s.messageId;
          if (key && seenSourceIds.has(key)) return false;
          if (key) seenSourceIds.add(key);
          return true;
        });

      const assistantMsg: ChatMessage = {
        id: genId(),
        role: 'assistant',
        content: parsed.reply || 'I processed your request but couldn\'t generate a response.',
        timestamp: new Date().toISOString(),
        sources,
        suggestions: (parsed.suggestions || []).slice(0, 4),
        stats: { messagesSearched: totalMessages, sourcesFound: sources.length },
        model: attempt > 0 ? retryModelId : modelId,
        retryCount: attempt > 0 ? attempt : undefined,
      };

      pushMessage(sessionId, assistantMsg, userId);
      log.info('AI Chat response',
        `model=${attempt > 0 ? retryModelId : modelId} | query="${userQuery.slice(0, 40)}" | sources=${sources.length} | total=${totalMessages}`);

      const sessionTitle = sessionMetaStore.get(sessionId)?.title;
      return { message: assistantMsg, conversationId: sessionId, sessionId, sessionTitle };

    } catch (error: any) {
      lastError = error;
      log.error(`AI Chat attempt ${attempt + 1}/${MAX_RETRIES + 1} failed`, error.message);
      if (attempt < MAX_RETRIES) {
        // Brief delay before retry
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  // All retries exhausted
  const errorMsg: ChatMessage = {
    id: genId(),
    role: 'assistant',
    content: `I ran into an error and tried ${MAX_RETRIES + 1} times but couldn't recover: *${lastError?.message}*. Please try again or use a different model.`,
    timestamp: new Date().toISOString(),
    sources: [],
    suggestions: ['Try a simpler question', 'Switch to a faster model', 'Show recent messages'],
    stats: { messagesSearched: totalMessages, sourcesFound: 0 },
    model: modelId,
    retryCount: MAX_RETRIES,
  };
  pushMessage(sessionId, errorMsg, userId);
  const errTitle = sessionMetaStore.get(sessionId)?.title;
  return { message: errorMsg, conversationId: sessionId, sessionId, sessionTitle: errTitle };
}

// ── Streaming chat function ─────────────────────────────────────────────────

export type StreamChunk =
  | { delta: string; done: false }
  | { done: true; sources: ChatSource[]; suggestions: string[]; stats: { messagesSearched: number; sourcesFound: number }; sessionId: string; sessionTitle?: string; model: string };

export async function chatStream(
  userQuery: string,
  messages: MessageData[],
  userId: string,
  sessionId: string,
  totalInDb: number,
  modelOverride: ModelId | undefined,
  onChunk: (chunk: StreamChunk) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!genAI) initChatAI();

  const totalMessages = totalInDb || messages.length;
  const modelId = modelOverride || getUserModel(userId);

  // Store user message
  const userMsg: ChatMessage = {
    id: genId(),
    role: 'user',
    content: userQuery,
    timestamp: new Date().toISOString(),
  };
  pushMessage(sessionId, userMsg, userId);

  // Clean & search
  const cleanedMessages = messages.map(cleanMessageContent);
  const keywords = extractKeywordsSync(userQuery);
  const dateRange = detectDateQuery(userQuery);

  let candidates: MessageData[];
  if (keywords.length > 0 || dateRange) {
    candidates = searchByKeywords(keywords, cleanedMessages, 300, dateRange);
  } else {
    candidates = cleanedMessages.slice().sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    ).slice(0, 300).reverse();
  }

  const model = getModelInstance(modelId);
  if (!model) {
    onChunk({ done: true, sources: [], suggestions: [], stats: { messagesSearched: totalMessages, sourcesFound: 0 }, sessionId, model: modelId });
    return;
  }

  const history = getHistory(sessionId);
  const messageContext = buildMessageContext(candidates);
  const prompt = buildConversationPrompt(userQuery, history.slice(0, -1), messageContext, candidates.length, totalMessages);

  try {
    const result = await model.generateContentStream(prompt);
    let fullText = '';

    for await (const chunk of result.stream) {
      if (signal?.aborted) break;
      const delta = chunk.text();
      if (delta) {
        fullText += delta;
        onChunk({ delta, done: false });
      }
    }

    // Parse JSON from streamed text
    let parsed: any = {};
    const jsonMatch = fullText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch {}
    }
    // If the full text is not valid JSON, treat the whole thing as a reply
    const reply = parsed.reply || fullText;

    // Match-based sources
    const replyLower = reply.toLowerCase();
    const seenIds = new Set<string>();
    const sources: ChatSource[] = candidates
      .filter(m => {
        const s = (m.sender || '').toLowerCase();
        const c = (m.chat_name || '').toLowerCase();
        return (s.length > 2 && replyLower.includes(s)) || (c.length > 2 && replyLower.includes(c));
      })
      .slice(0, 8)
      .map(m => buildSource(m, 'Mentioned in response'))
      .filter(s => {
        const k = s.messageKey || s.messageId;
        if (k && seenIds.has(k)) return false;
        if (k) seenIds.add(k);
        return true;
      });

    const assistantMsg: ChatMessage = {
      id: genId(),
      role: 'assistant',
      content: reply,
      timestamp: new Date().toISOString(),
      sources,
      suggestions: (parsed.suggestions || []).slice(0, 4),
      stats: { messagesSearched: totalMessages, sourcesFound: sources.length },
      model: modelId,
    };
    pushMessage(sessionId, assistantMsg, userId);

    const sessionTitle = sessionMetaStore.get(sessionId)?.title;
    onChunk({ done: true, sources, suggestions: assistantMsg.suggestions || [], stats: assistantMsg.stats!, sessionId, sessionTitle, model: modelId });

  } catch (err: any) {
    if (signal?.aborted) return;
    log.error('chatStream failed', err.message);
    onChunk({ done: true, sources: [], suggestions: [], stats: { messagesSearched: totalMessages, sourcesFound: 0 }, sessionId, model: modelId });
  }
}

// ── Helper: build a ChatSource from MessageData ─────────────────────────────

function buildSource(m: MessageData, reason: string): ChatSource {
  const meta = m.metadata;
  return {
    messageId: m.id,
    sender: m.sender,
    chatName: m.chat_name || 'Unknown',
    content: m.content,
    timestamp: m.timestamp,
    matchReason: reason,
    mediaType: meta?.mediaType || null,
    messageKey: meta?.messageKey || null,
    hasMedia: !!meta?.mediaType,
    documentName: meta?.document?.fileName || null,
    imageDescription: meta?.imageAnalysis?.description || null,
    documentSummary: (meta?.documentAnalysis?.summary && !isCorruptedContent(meta.documentAnalysis.summary))
      ? meta.documentAnalysis.summary : null,
  };
}
