/**
 * AI Chat Service — Conversational AI over WhatsApp & Gmail messages
 *
 * Features:
 *  - Multi-turn conversation with memory across sessions
 *  - Long-term USER MEMORY: remembers name, preferences, language, contacts
 *  - Web search via Gemini Google Search grounding (real-time info)
 *  - Smart intent routing: inbox | web | general knowledge | task
 *  - Dynamic model selection: user picks or auto-selects
 *  - Task management: create / complete / delete tasks via chat
 *  - Privacy-aware: never exposes messages from blocked senders
 *  - Auto-retry on AI failures (up to 2 retries)
 *  - Corrupted document content filtering
 *  - Source citations with full media references
 *  - File analysis: documents, images
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { randomUUID } from 'crypto';
import log from './activity-log';
import { supabase } from '../config/supabase';
import { hybridRetrieve, rewriteQuery, RetrievalResult } from './hybrid-retrieval';
import { initEmbeddingService, backfillEmbeddings } from './embedding-service';
import { getCachedResponse, setCachedResponse } from './response-cache';
import type { RerankResult } from './reranker-service';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;

let genAI: GoogleGenerativeAI | null = null;

// ── Supported models ────────────────────────────────────────────────────────

export const AVAILABLE_MODELS = [
  { id: 'gemini-3.1-pro-preview',        label: 'Gemini 3.1 Pro',         tier: 'premium' },
  { id: 'gemini-3-flash-preview',        label: 'Gemini 3 Flash',         tier: 'fast'    },
  { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite',  tier: 'lite'    },
  { id: 'gemini-2.5-flash',              label: 'Gemini 2.5 Flash',       tier: 'fast'    },
] as const;

export type ModelId = typeof AVAILABLE_MODELS[number]['id'];

const DEFAULT_MODEL: ModelId = 'gemini-3-flash-preview';

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
  return genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      maxOutputTokens: 4096,
    },
  });
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: ChatSource[];
  webSources?: WebSource[];
  suggestions?: string[];
  stats?: { messagesSearched: number; sourcesFound: number };
  /** Which model produced this response */
  model?: string;
  /** If we retried, how many attempts */
  retryCount?: number;
  /** Task action the AI performed */
  taskAction?: TaskActionResult;
  /** Query intent classification */
  intent?: QueryIntent;
}

export interface WebSource {
  title: string;
  uri: string;
  snippet?: string;
}

export type QueryIntent = 'inbox' | 'web' | 'general' | 'task' | 'memory';

export interface UserMemoryFact {
  key: string;
  value: string;
  confidence?: number;
  source?: string;
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

/** Load a session's history from Supabase (lazy, once per sessionId). userId enforced for isolation. */
export async function ensureChatHistoryLoaded(sessionId: string, userId?: string): Promise<void> {
  if (conversationStore.has(sessionId)) {
    // Verify ownership if already loaded
    const existingMeta = sessionMetaStore.get(sessionId);
    if (userId && existingMeta && existingMeta.userId !== userId) {
      throw new Error('Access denied: session belongs to another user');
    }
    return;
  }
  if (!supabase) { conversationStore.set(sessionId, []); return; }
  try {
    let query = supabase
      .from('ai_chat_history')
      .select('messages,title,user_id,created_at,updated_at,last_message_at')
      .eq('session_id', sessionId);
    // Enforce user isolation at the DB level
    if (userId) query = query.eq('user_id', userId);
    const { data } = await query.maybeSingle();
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

export async function clearChatHistory(sessionId: string, userId?: string): Promise<void> {
  // Verify ownership before clearing
  const meta = sessionMetaStore.get(sessionId);
  if (userId && meta && meta.userId !== userId) {
    throw new Error('Access denied: session belongs to another user');
  }
  conversationStore.delete(sessionId);
  if (meta) { meta.messageCount = 0; meta.title = 'New Chat'; }
  if (!supabase) return;
  try {
    let query = supabase.from('ai_chat_history')
      .update({ messages: [], title: 'New Chat', updated_at: new Date().toISOString() })
      .eq('session_id', sessionId);
    if (userId) query = query.eq('user_id', userId);
    await query;
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
    // Initialize embedding service for vector search
    initEmbeddingService();
    // Fire-and-forget: backfill embeddings for existing messages on first startup
    backfillEmbeddings().then(r => {
      if (r.total > 0) log.info('Startup backfill', `Embedded ${r.success}/${r.total} messages`);
    }).catch(() => {});
    log.success('AI Chat initialized', `Models: ${AVAILABLE_MODELS.map(m => m.id).join(', ')}`);
    return true;
  } catch (error: any) {
    log.error('Failed to initialize AI Chat', error.message);
    return false;
  }
}

// ── User Memory System ────────────────────────────────────────────────────
// Persistent per-user facts extracted from conversations + explicit statements.
// Injected into every AI prompt so the AI always knows who it's talking to.

// In-memory cache: userId → {key → value}
const userMemoryCache = new Map<string, Record<string, string>>();

export async function loadUserMemory(userId: string): Promise<Record<string, string>> {
  if (userMemoryCache.has(userId)) return userMemoryCache.get(userId)!;
  if (!supabase) return {};
  try {
    const { data } = await supabase
      .from('user_memory')
      .select('key,value')
      .eq('user_id', userId)
      .limit(50);
    const mem: Record<string, string> = {};
    for (const row of (data || [])) mem[row.key] = row.value;
    userMemoryCache.set(userId, mem);
    return mem;
  } catch { return {}; }
}

export async function saveUserMemoryFact(userId: string, key: string, value: string, source = 'chat'): Promise<void> {
  const mem = userMemoryCache.get(userId) || {};
  mem[key] = value;
  userMemoryCache.set(userId, mem);
  if (!supabase) return;
  try {
    await supabase.from('user_memory').upsert(
      { user_id: userId, key, value, source, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' }
    );
  } catch {}
}

export async function deleteUserMemoryFact(userId: string, key: string): Promise<void> {
  const mem = userMemoryCache.get(userId) || {};
  delete mem[key];
  userMemoryCache.set(userId, mem);
  if (!supabase) return;
  try {
    await supabase.from('user_memory').delete().eq('user_id', userId).eq('key', key);
  } catch {}
}

export async function getUserMemoryAll(userId: string): Promise<UserMemoryFact[]> {
  const mem = await loadUserMemory(userId);
  return Object.entries(mem).map(([key, value]) => ({ key, value }));
}

/** Asynchronously extract user facts from a conversation turn and persist them. */
async function extractAndSaveMemory(userId: string, userQuery: string, aiReply: string): Promise<void> {
  if (!genAI) return;
  const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' as ModelId });
  try {
    const prompt = `Extract 0-5 personal facts the USER explicitly stated about themselves from this message.
Only extract facts the user said: their name, language they speak, their job/workplace, where they live, preferences, timezone, or similar personal context.
Do NOT extract facts about other people, do NOT hallucinate.
If nothing is extractable, return {}.

User's message: "${userQuery.slice(0, 400)}"

Return ONLY valid JSON, no prose: {"fact_key": "fact_value"}
where fact_key examples: user_name, user_language, user_location, user_job, user_timezone, preference_response_style, frequent_contact_X`;
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const match = text.match(/\{[^}]*\}/);
    if (!match) return;
    const facts: Record<string, string> = JSON.parse(match[0]);
    for (const [k, v] of Object.entries(facts)) {
      if (k && v && typeof v === 'string' && v.length < 200) {
        await saveUserMemoryFact(userId, k, v, 'extracted');
        log.info('Memory saved', `user=${userId} key=${k}`);
      }
    }
  } catch {}
}

function buildMemorySection(memory: Record<string, string>): string {
  const entries = Object.entries(memory);
  if (entries.length === 0) return '';
  const lines = entries.slice(0, 20).map(([k, v]) => {
    const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `  - ${label}: ${v}`;
  }).join('\n');
  return `\nUSER PROFILE (facts you know about this user — use naturally in your answers):\n${lines}\n`;
}

// ── Query Intent Detection ────────────────────────────────────────────────
// Classifies what the user wants: search their inbox, search the web,
// answer from AI knowledge, manage tasks, or update their memory profile.

const WEB_SIGNALS   = /\b(news|latest|current events|today's news|stock price|weather|sports score|match result|trending|who is|what is [a-z]|how do|how does|how to|meaning of|definition|translate|convert|calculate|formula|recipe|tutorial|best way|explain|difference between|when was|where is|why is|wikipedia|search for)\b/i;
const INBOX_SIGNALS = /\b(message|messages|whatsapp|gmail|email|sent|received|wrote|said|asked|replied|chat|group|forward|document|file|pdf|photo|image|video|attachment|shared|somebody|someone sent|contact|inbox|unread|recent messages|latest messages|new messages|conversation|thread)\b|anything from|anything about|any message|tell me about messages|show me messages|what did .+ (say|send|write)|who sent/i;
const MEMORY_SIGNALS = /\b(remember (that|me|my|i am|i'm)|my name is|i am from|i live in|i work at|i speak|call me|update my|forget (that|my|me)|what do you know about me|about me|my preference|my profile)\b/i;

export function detectQueryIntent(query: string, inboxCandidateCount = 0): QueryIntent {
  // Task operations take priority
  if (detectTaskIntent(query).action !== 'none') return 'task';
  // Explicit memory management
  if (MEMORY_SIGNALS.test(query)) return 'memory';
  // Has strong inbox references OR inbox search returned good results
  if (INBOX_SIGNALS.test(query) || inboxCandidateCount > 3) return 'inbox';
  // Needs live web data
  if (WEB_SIGNALS.test(query)) return 'web';
  // Short queries with no inbox results → likely general knowledge
  if (inboxCandidateCount === 0) return 'general';
  return 'inbox';
}

// ── Web Search via Gemini Google Search Grounding ─────────────────────────
// Uses Gemini's native google_search tool to retrieve real-time information.

export async function searchWeb(
  userQuery: string,
  conversationHistory: ChatMessage[],
  memory: Record<string, string>,
  modelId: ModelId,
): Promise<{ reply: string; webSources: WebSource[]; suggestions: string[] }> {
  if (!genAI) return { reply: 'AI not available.', webSources: [], suggestions: [] };

  const memSection = buildMemorySection(memory);
  const histLines = conversationHistory.slice(-6).map(h =>
    h.role === 'user' ? `User: ${h.content.slice(0, 300)}` : `Assistant: ${h.content.slice(0, 300)}`
  ).join('\n');

  const prompt = `You are Mindline AI — a smart, helpful assistant.
Today: ${new Date().toISOString().slice(0, 10)}
${memSection}
${histLines ? `Recent conversation:\n${histLines}\n` : ''}
User's question: ${userQuery}

Instructions:
- Give a thorough, well-organized answer using the latest information available
- Use markdown: **bold** for key terms, bullet points for lists, > for quotes
- If citing data, mention the source
- Be precise with numbers, dates, prices — don't approximate
- After your main answer, add a JSON block with follow-up suggestions

End your response with this JSON on a new line:
{"suggestions": ["follow-up 1", "follow-up 2", "follow-up 3"]}`;

  try {
    // Use Google Search grounding for real-time info
    const modelWithSearch = (genAI as any).getGenerativeModel({
      model: modelId,
      tools: [{ googleSearch: {} }],
    });
    const result = await modelWithSearch.generateContent(prompt);
    const response = await result.response;
    const text: string = response.text();

    // Extract grounding metadata (web sources)
    const groundingMeta = (response as any).candidates?.[0]?.groundingMetadata;
    const webSources: WebSource[] = ((groundingMeta?.groundingChunks || []) as any[])
      .map(c => ({ title: c.web?.title || '', uri: c.web?.uri || '' }))
      .filter(s => s.uri);

    // Try to extract suggestions JSON from end of response
    let reply = text;
    let suggestions: string[] = [];
    const sugMatch = text.match(/\{[\s\S]*"suggestions"[\s\S]*\}/);
    if (sugMatch) {
      try {
        const parsed = JSON.parse(sugMatch[0]);
        suggestions = (parsed.suggestions || []).slice(0, 4);
        reply = text.slice(0, text.indexOf(sugMatch[0])).trim();
      } catch {}
    }
    if (!reply) reply = text;

    return { reply, webSources, suggestions };
  } catch (err: any) {
    log.error('Web search failed, falling back to model knowledge', err.message);
    // Fallback: answer from model training data without grounding
    try {
      const fallbackModel = getModelInstance(modelId) || getModelInstance('gemini-3-flash-preview' as ModelId);
      if (!fallbackModel) throw new Error('No model');
      const result2 = await fallbackModel.generateContent(prompt);
      const text2 = result2.response.text();
      return { reply: text2, webSources: [], suggestions: [] };
    } catch {
      return { reply: 'I could not retrieve information for this question. Please try again.', webSources: [], suggestions: [] };
    }
  }
}

// ── Handle Memory Updates ─────────────────────────────────────────────────

async function handleMemoryUpdate(userId: string, userQuery: string): Promise<string> {
  // Extract explicit facts the user is telling us to remember
  const rememberMatch = userQuery.match(/remember\s+(?:that\s+)?(.+)/i);
  const myNameIs = userQuery.match(/(?:my name is|call me|i am|i'm)\s+([A-Za-z]+)/i);
  const iLiveIn = userQuery.match(/(?:i live in|i am from|i'm from)\s+(.+?)(?:\.|$)/i);
  const iWorkAt = userQuery.match(/(?:i work at|i work for|i'm at)\s+(.+?)(?:\.|$)/i);
  const iSpeak = userQuery.match(/(?:i speak|my language is)\s+(.+?)(?:\.|$)/i);

  const saved: string[] = [];

  if (myNameIs) { await saveUserMemoryFact(userId, 'user_name', myNameIs[1], 'explicit'); saved.push(`your name (${myNameIs[1]})`); }
  if (iLiveIn) { await saveUserMemoryFact(userId, 'user_location', iLiveIn[1].trim(), 'explicit'); saved.push(`location (${iLiveIn[1].trim()})`); }
  if (iWorkAt) { await saveUserMemoryFact(userId, 'user_job', iWorkAt[1].trim(), 'explicit'); saved.push(`workplace (${iWorkAt[1].trim()})`); }
  if (iSpeak) { await saveUserMemoryFact(userId, 'user_language', iSpeak[1].trim(), 'explicit'); saved.push(`language (${iSpeak[1].trim()})`); }
  if (rememberMatch && saved.length === 0) {
    await saveUserMemoryFact(userId, `note_${Date.now()}`, rememberMatch[1].trim(), 'explicit');
    saved.push(`note: "${rememberMatch[1].trim()}"`);
  }

  if (saved.length > 0) {
    return `Got it! I've saved to your profile: ${saved.join(', ')}. I'll remember this in all future conversations.`;
  }
  return 'I\'ve noted that. If you\'d like me to remember specific facts about you, say "My name is..." or "Remember that..."';
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

// ── Query complexity detection ──────────────────────────────────────────────
// Returns 'simple' | 'moderate' | 'complex' to drive dynamic context window
function detectQueryComplexity(query: string, keywordCount: number): 'simple' | 'moderate' | 'complex' {
  const q = query.toLowerCase();
  // Complex: comparisons, aggregations, multi-person, analysis
  if (/\b(compare|difference|between .+ and|summarize all|overview|analysis|every|all messages from|everything)\b/.test(q)) return 'complex';
  if (/\b(how many|count|total|statistics|trend|pattern|history of)\b/.test(q)) return 'complex';
  if (keywordCount >= 5) return 'complex';
  // Simple: single-entity lookups, yes/no, greetings
  if (keywordCount <= 1) return 'simple';
  if (/\b(latest|last|most recent|newest|did .+ send)\b/.test(q)) return 'simple';
  return 'moderate';
}

// Dynamic context limits based on query complexity
function getContextLimits(complexity: 'simple' | 'moderate' | 'complex'): { candidateLimit: number; contentMaxLen: number; tokenBudgetHint: string } {
  switch (complexity) {
    case 'simple':   return { candidateLimit: 80,  contentMaxLen: 600,  tokenBudgetHint: 'Reply concisely in 1-3 short paragraphs. Get straight to the point.' };
    case 'moderate': return { candidateLimit: 200, contentMaxLen: 1000, tokenBudgetHint: 'Reply in a well-structured response. Use bullet points for multiple items.' };
    case 'complex':  return { candidateLimit: 350, contentMaxLen: 1200, tokenBudgetHint: 'Provide a thorough, detailed analysis. Use headers, bullets, and clear organization.' };
  }
}

// ── Conversation history summarization ──────────────────────────────────────
// Compresses old conversation turns into a compact summary to reduce token bloat
function summarizeHistory(history: ChatMessage[]): { summary: string; recentTurns: ChatMessage[] } {
  if (history.length <= 8) {
    // Short history — keep all turns, no summarization needed
    return { summary: '', recentTurns: history };
  }

  // Split: older turns get summarized, recent 8 kept verbatim
  const cutoff = history.length - 8;
  const olderTurns = history.slice(0, cutoff);
  const recentTurns = history.slice(cutoff);

  // Build compact summary of older turns
  const topicSet = new Set<string>();
  for (const turn of olderTurns) {
    if (turn.role === 'user') {
      // Extract key topics from user queries
      const words = turn.content.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(w => w.length >= 3 && !AI_STOP_WORDS.has(w));
      words.slice(0, 3).forEach(w => topicSet.add(w));
    }
  }

  const topics = [...topicSet].slice(0, 10).join(', ');
  const turnCount = olderTurns.length;
  const summary = topics
    ? `[Earlier in this conversation (${turnCount} messages): discussed ${topics}]`
    : `[Earlier: ${turnCount} messages exchanged]`;

  return { summary, recentTurns };
}

// ── Pre-filter ──────────────────────────────────────────────────────────────

/**
 * PASS 1 filter — search all messages for keyword matches, return top hits.
 * Uses TF-IDF-inspired scoring: rarer keywords get higher weight.
 * Optionally pre-filters by a date range before keyword matching.
 */
function searchByKeywords(keywords: string[], messages: MessageData[], limit = 300, dateRange?: DateRange | null): MessageData[] {
  // Pre-filter by date range if provided
  const pool = dateRange ? (() => {
    const from = new Date(dateRange.dateFrom).getTime();
    const to   = new Date(dateRange.dateTo).getTime();
    return messages.filter(m => {
      const t = new Date(m.timestamp).getTime();
      return t >= from && t <= to;
    });
  })() : messages;

  if (keywords.length === 0) return pool.slice(-limit);

  // Compute IDF-like weight per keyword: rarer keywords score higher
  const kwFrequency = new Map<string, number>();
  const blobs = pool.map(m => [
    m.sender, m.chat_name ?? '', m.content,
    m.metadata?.document?.fileName ?? '',
    m.metadata?.imageAnalysis?.description ?? '',
    m.metadata?.imageAnalysis?.extractedText ?? '',
    m.metadata?.documentAnalysis?.summary ?? '',
    m.metadata?.documentAnalysis?.extractedText ?? '',
    m.metadata?.documentAnalysis?.topics?.join(' ') ?? '',
    m.metadata?.documentAnalysis?.keyEntities?.join(' ') ?? '',
    m.metadata?.documentAnalysis?.documentType ?? '',
  ].join(' ').toLowerCase());

  for (const kw of keywords) {
    let docCount = 0;
    for (const blob of blobs) { if (blob.includes(kw)) docCount++; }
    kwFrequency.set(kw, docCount);
  }

  const poolSize = pool.length || 1;
  const kwWeights = new Map<string, number>();
  for (const kw of keywords) {
    const df = kwFrequency.get(kw) || 0;
    // IDF weight: rare keywords get higher score
    kwWeights.set(kw, df === 0 ? 0 : Math.log(poolSize / (df + 1)) + 1);
  }

  const results: Array<{ msg: MessageData; score: number; hits: number }> = [];
  for (let i = 0; i < pool.length; i++) {
    const blob = blobs[i];
    let score = 0;
    let hits = 0;
    for (const kw of keywords) {
      if (blob.includes(kw)) {
        hits++;
        score += kwWeights.get(kw) || 1;
        // Bonus for exact match in sender/chat_name (high-value fields)
        const senderLower = pool[i].sender?.toLowerCase() || '';
        const chatLower = pool[i].chat_name?.toLowerCase() || '';
        if (senderLower.includes(kw)) score += 2;
        if (chatLower.includes(kw)) score += 1.5;
      }
    }
    if (hits > 0) {
      // Recency boost: newer messages get a small bonus
      const ageMs = Date.now() - new Date(pool[i].timestamp).getTime();
      const recencyBoost = Math.max(0, 1 - (ageMs / (30 * 24 * 60 * 60 * 1000))); // decays over 30 days
      score += recencyBoost * 0.5;
      results.push({ msg: pool[i], score, hits });
    }
  }

  // Sort by score desc, then by recency for ties
  results.sort((a, b) =>
    b.score !== a.score
      ? b.score - a.score
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

function buildMessageContext(messages: MessageData[], contentMaxLen = 1200): string {
  return messages.map((m, i) => {
    const ts = fmtTs(m.timestamp);
    const rel = fmtRelative(m.timestamp);
    const mediaType = m.metadata?.mediaType;
    let line = `[${i}] FROM: ${m.sender} | CHAT: ${m.chat_name || 'DM'} | TIME: ${ts} (${rel})`;
    if (mediaType) line += ` | TYPE: ${mediaType.toUpperCase()}`;

    // Dynamic content length based on query complexity
    const contentDisplay = m.content.length > contentMaxLen ? m.content.slice(0, contentMaxLen) + '…' : m.content;
    line += `\nCONTENT: ${contentDisplay}`;

    // ── Document/File info — critical for file queries ──
    if (m.metadata?.document?.fileName) {
      const doc = m.metadata.document;
      line += `\nFILE: "${doc.fileName}" (${doc.mimeType || 'unknown'})`;
      if (doc.fileSize) line += ` [${Math.round(doc.fileSize/1024)}KB]`;
      if (doc.pageCount) line += ` [${doc.pageCount} pages]`;
    }

    // ── Image analysis — full description + OCR text ──
    if (m.metadata?.imageAnalysis?.description) {
      line += `\nIMAGE_DESCRIPTION: ${m.metadata.imageAnalysis.description}`;
    }
    if (m.metadata?.imageAnalysis?.extractedText) {
      line += `\nIMAGE_OCR_TEXT: ${m.metadata.imageAnalysis.extractedText}`;
    }

    // ── Document analysis — full summary + topics + entities ──
    if (m.metadata?.documentAnalysis) {
      const da = m.metadata.documentAnalysis;
      if (da.summary && !isCorruptedContent(da.summary)) {
        line += `\nDOC_SUMMARY: ${da.summary}`;
      }
      if (da.extractedText && !isCorruptedContent(da.extractedText)) {
        line += `\nDOC_KEY_TEXT: ${da.extractedText.slice(0, 800)}`;
      }
      if (da.topics?.length) {
        line += `\nDOC_TOPICS: ${da.topics.join(', ')}`;
      }
      if (da.keyEntities?.length) {
        line += `\nDOC_ENTITIES: ${da.keyEntities.join(', ')}`;
      }
      if (da.documentType) {
        line += `\nDOC_TYPE: ${da.documentType}`;
      }
    }

    // ── Media key for download reference ──
    if (m.metadata?.messageKey) {
      line += `\nMEDIA_KEY: ${m.metadata.messageKey}`;
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
  totalMessages: number,
  memorySection = '',
  tokenBudgetHint = ''
): string {
  // Summarize old history to reduce token bloat, keep recent turns verbatim
  const { summary: historySummary, recentTurns } = summarizeHistory(history);

  let conversationSection = '';
  if (historySummary) {
    conversationSection += `\n${historySummary}\n`;
  }
  if (recentTurns.length > 0) {
    const histLines = recentTurns.map(h => {
      if (h.role === 'user') {
        return `USER_ASKED: ${h.content.slice(0, 500)}`;
      } else {
        const brief = h.content.replace(/\*\*/g, '').slice(0, 500);
        return `AI_REPLIED: ${brief}${h.content.length > 500 ? '...' : ''}`;
      }
    }).join('\n');
    conversationSection +=
      '\nPRIOR CONVERSATION TURNS (for follow-up context ONLY — these are NOT inbox messages):\n' +
      histLines + '\n';
  }

  const budgetLine = tokenBudgetHint ? `\nRESPONSE STYLE: ${tokenBudgetHint}\n` : '';

  return `You are Mindline AI — a smart personal assistant with full access to the user's WhatsApp and Gmail inbox.
You can read every message, document, image, and attachment they've received.

TODAY: ${new Date().toISOString().slice(0, 10)}
DATABASE: ${totalMessages} total messages | ${candidateCount} relevant messages shown below
${memorySection}${conversationSection}${budgetLine}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INBOX DATA (sorted oldest → newest — bottom entries = most recent)
Each entry has: [index] FROM | CHAT | TIME (relative age)
Fields: CONTENT, FILE, IMAGE_DESCRIPTION, IMAGE_OCR_TEXT, DOC_SUMMARY, DOC_KEY_TEXT, DOC_TOPICS, DOC_ENTITIES, DOC_TYPE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${messageContext}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

USER: "${userQuery}"

INSTRUCTIONS:
1. ANSWER FROM THE INBOX DATA ABOVE — this is the user's real inbox. Search every field (CONTENT, FILE, IMAGE_DESCRIPTION, IMAGE_OCR_TEXT, DOC_SUMMARY, DOC_KEY_TEXT, DOC_ENTITIES).
2. For "recent" / "latest" / "new" queries → entries near the BOTTOM are newest. Check relative ages.
3. For file/document queries → look at FILE, DOC_SUMMARY, DOC_KEY_TEXT, DOC_TYPE fields. Report: filename (bold), sender, time, and what the doc contains.
4. For image queries → look at IMAGE_DESCRIPTION and IMAGE_OCR_TEXT. Describe what the image shows and any text found in it.
5. ALWAYS cite: **sender name**, chat/group name, and when it was sent (relative time like "2 hours ago").
6. If a message has both text content AND a file/image, mention both.
7. Use markdown: **bold** names and filenames, bullet points for lists, > blockquotes for quoting messages.
8. If quoting a message, use the exact content — don't paraphrase.
9. If the user asks about a document's contents, use DOC_SUMMARY and DOC_KEY_TEXT to explain what's in it.
10. NEVER say "I couldn't find anything" if there ARE matching entries above — re-read the data carefully.
11. If there are truly 0 relevant entries shown above (empty INBOX DATA), tell the user honestly "I don't see any matching messages in your inbox" and suggest refining their search or checking spelling. Do NOT make up fake messages.
12. Prior conversation turns are for context only — do NOT treat old AI replies as inbox data.
13. Keep answers focused and organized. Lead with the most important finding.

Respond ONLY with this JSON (no text outside):
{
  "reply": "Your markdown-formatted answer. Bold sender names, filenames. Cite relative times. Use bullet points for multiple items. Quote key content with > blockquotes when helpful.",
  "suggestions": ["follow-up question 1", "follow-up question 2", "follow-up question 3", "follow-up question 4"]
}`;  // B3: sourceIndices removed — match-based sources computed after reply
}

/**
 * Build a streaming-optimised prompt that does NOT require JSON output.
 * The AI responds in plain markdown so chunks can be sent directly to the client
 * without showing raw JSON wrapper to the user during streaming.
 */
function buildStreamingPrompt(
  userQuery: string,
  history: ChatMessage[],
  messageContext: string,
  candidateCount: number,
  totalMessages: number,
  memorySection = '',
  tokenBudgetHint = ''
): string {
  // Summarize old history to reduce token bloat, keep recent turns verbatim
  const { summary: historySummary, recentTurns } = summarizeHistory(history);

  let conversationSection = '';
  if (historySummary) {
    conversationSection += `\n${historySummary}\n`;
  }
  if (recentTurns.length > 0) {
    const histLines = recentTurns.map(h => {
      if (h.role === 'user') {
        return `USER_ASKED: ${h.content.slice(0, 500)}`;
      } else {
        const brief = h.content.replace(/\*\*/g, '').slice(0, 500);
        return `AI_REPLIED: ${brief}${h.content.length > 500 ? '...' : ''}`;
      }
    }).join('\n');
    conversationSection +=
      '\nPRIOR CONVERSATION TURNS (for follow-up context ONLY — these are NOT inbox messages):\n' +
      histLines + '\n';
  }

  const budgetLine = tokenBudgetHint ? `\nRESPONSE STYLE: ${tokenBudgetHint}\n` : '';

  return `You are Mindline AI — a smart personal assistant with full access to the user's WhatsApp and Gmail inbox.
You can read every message, document, image, and attachment they've received.

TODAY: ${new Date().toISOString().slice(0, 10)}
DATABASE: ${totalMessages} total messages | ${candidateCount} relevant messages shown below
${memorySection}${conversationSection}${budgetLine}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INBOX DATA (sorted oldest → newest — bottom entries = most recent)
Each entry has: [index] FROM | CHAT | TIME (relative age)
Fields: CONTENT, FILE, IMAGE_DESCRIPTION, IMAGE_OCR_TEXT, DOC_SUMMARY, DOC_KEY_TEXT, DOC_TOPICS, DOC_ENTITIES, DOC_TYPE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${messageContext}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

USER: "${userQuery}"

INSTRUCTIONS:
1. ANSWER FROM THE INBOX DATA ABOVE — this is the user's real inbox. Search every field (CONTENT, FILE, IMAGE_DESCRIPTION, IMAGE_OCR_TEXT, DOC_SUMMARY, DOC_KEY_TEXT, DOC_ENTITIES).
2. For "recent" / "latest" / "new" queries → entries near the BOTTOM are newest. Check relative ages.
3. For file/document queries → look at FILE, DOC_SUMMARY, DOC_KEY_TEXT, DOC_TYPE fields. Report: filename (bold), sender, time, and what the doc contains.
4. For image queries → look at IMAGE_DESCRIPTION and IMAGE_OCR_TEXT. Describe what the image shows and any text found in it.
5. ALWAYS cite: **sender name**, chat/group name, and when it was sent (relative time like "2 hours ago").
6. If a message has both text content AND a file/image, mention both.
7. Use markdown formatting: **bold** for names and filenames, bullet points for lists, > blockquotes for quoting messages.
8. If quoting a message, use the exact content — don't paraphrase.
9. If the user asks about a document's contents, use DOC_SUMMARY and DOC_KEY_TEXT to explain what's in it.
10. NEVER say "I couldn't find anything" if there ARE matching entries above — re-read the data carefully.
11. If there are truly 0 relevant entries shown above (empty INBOX DATA), tell the user honestly "I don't see any matching messages in your inbox" and suggest refining their search or checking spelling. Do NOT make up fake messages.
12. Prior conversation turns are for context only — do NOT treat old AI replies as inbox data.
13. Keep answers focused and organized. Lead with the most important finding.

Respond directly in markdown. Do NOT wrap your response in JSON or code blocks. Just write the answer naturally using markdown formatting.`;
}

/**
 * Generate follow-up suggestions based on the query intent and reply content.
 * This replaces the JSON-embedded suggestions for streaming mode.
 */
function generateSuggestions(userQuery: string, reply: string, intent: QueryIntent): string[] {
  const q = userQuery.toLowerCase();

  if (intent === 'task') {
    return ['Show all my tasks', 'What tasks are due today?', 'Create a new task', 'Mark tasks as complete'];
  }
  if (intent === 'web') {
    return ['Tell me more about this', 'Search for related topics', 'Summarize the key points', 'What else is trending?'];
  }
  if (intent === 'memory') {
    return ['What do you know about me?', 'Update my preferences', 'Forget everything about me'];
  }

  // Intent-based defaults for inbox queries
  if (q.includes('file') || q.includes('document') || q.includes('pdf') || q.includes('image') || q.includes('photo')) {
    return ['Show more files', 'Find recent documents', 'What images were sent?', 'Summarize this document'];
  }
  if (q.includes('summar') || q.includes('today') || q.includes('overview')) {
    return ['Show yesterday\'s summary', 'What tasks came up?', 'Any urgent messages?', 'Who messaged me?'];
  }
  if (q.includes('task') || q.includes('todo') || q.includes('deadline') || q.includes('action')) {
    return ['Show all tasks', 'What\'s most urgent?', 'Tasks from this week', 'Create a reminder'];
  }

  // Generic follow-ups
  return ['Tell me more', 'Show recent messages', 'Find tasks & action items', 'Summarize today'];
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

  // 3. HYBRID RAG RETRIEVAL — vector + keyword + reranker
  //    Uses pgvector semantic search, keyword search, and multi-signal reranking.
  const keywords = extractKeywordsSync(userQuery);
  const dateRange = detectDateQuery(userQuery);
  const complexity = detectQueryComplexity(userQuery, keywords.length);
  const contextLimits = getContextLimits(complexity);
  log.info('Hybrid retrieval starting', `query="${userQuery.slice(0,40)}" complexity=${complexity} limit=${contextLimits.candidateLimit}`);

  // Check response cache first
  const cachedResp = await getCachedResponse(userQuery, userId);
  if (cachedResp && cachedResp.message) {
    log.info('Cache hit', `query="${userQuery.slice(0,40)}"`);
    pushMessage(sessionId, cachedResp.message, userId);
    return cachedResp;
  }

  let candidates: MessageData[];
  let retrievalStats: any = {};
  try {
    const retrievalResult = await hybridRetrieve(userQuery, cleanedMessages, {
      userId,
      maxResults: contextLimits.candidateLimit,
      dateRange: dateRange ? { start: new Date(dateRange.dateFrom), end: new Date(dateRange.dateTo) } : null,
    });
    candidates = retrievalResult.candidates.map(c => ({
      id: c.id,
      sender: c.sender,
      chat_name: c.chat_name,
      content: c.content,
      timestamp: c.timestamp,
      classification: c.classification,
      metadata: c.metadata,
    }));
    retrievalStats = retrievalResult.stats;
    log.info('Hybrid retrieval complete',
      `vector=${retrievalStats.vectorHits} keyword=${retrievalStats.keywordHits} reranked=${retrievalStats.afterRerank} time=${retrievalStats.retrievalTimeMs}ms`);
  } catch (err: any) {
    // Fallback to keyword-only search if hybrid fails
    log.error('Hybrid retrieval failed, falling back to keyword search', err.message);
    if (keywords.length > 0 || dateRange) {
      candidates = searchByKeywords(keywords, cleanedMessages, contextLimits.candidateLimit, dateRange);
    } else {
      candidates = cleanedMessages
        .slice()
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, contextLimits.candidateLimit)
        .reverse();
    }
  }

  // 4. Load user memory + detect intent
  const memory = await loadUserMemory(userId);
  const memSection = buildMemorySection(memory);
  const intent = detectQueryIntent(userQuery, candidates.length);

  // 4a. Handle explicit memory commands — no AI model needed
  if (intent === 'memory') {
    const memReply = await handleMemoryUpdate(userId, userQuery);
    const memMsg: ChatMessage = {
      id: genId(),
      role: 'assistant',
      content: memReply,
      timestamp: new Date().toISOString(),
      sources: [],
      suggestions: ['What do you know about me?', 'Update my preferences', 'Forget everything about me'],
      stats: { messagesSearched: 0, sourcesFound: 0 },
      model: modelId,
      intent: 'memory',
    };
    pushMessage(sessionId, memMsg, userId);
    const memTitle = sessionMetaStore.get(sessionId)?.title;
    return { message: memMsg, conversationId: sessionId, sessionId, sessionTitle: memTitle };
  }

  // 4b. Handle web search OR general knowledge queries via Gemini grounding
  if (intent === 'web' || intent === 'general') {
    const historyForWeb = getHistory(sessionId);
    const { reply: webReply, webSources, suggestions: webSuggestions } = await searchWeb(
      userQuery, historyForWeb.slice(0, -1), memory, modelId
    );
    const webMsg: ChatMessage = {
      id: genId(),
      role: 'assistant',
      content: webReply,
      timestamp: new Date().toISOString(),
      sources: [],
      webSources,
      suggestions: webSuggestions,
      stats: { messagesSearched: 0, sourcesFound: webSources.length },
      model: modelId,
      intent: intent === 'web' ? 'web' : 'general',
    };
    pushMessage(sessionId, webMsg, userId);
    extractAndSaveMemory(userId, userQuery, webReply).catch(() => {});
    const webTitle = sessionMetaStore.get(sessionId)?.title;
    return { message: webMsg, conversationId: sessionId, sessionId, sessionTitle: webTitle };
  }

  // 5. If no AI available, return a basic response
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

  // 5. Attempt AI generation with auto-retry and improved fallback chain
  const MAX_RETRIES = 2;
  // Fallback chain: user's model → flash → 2.5-flash (covers quota, model, and transient errors)
  const FALLBACK_CHAIN: ModelId[] = [
    modelId,
    modelId !== 'gemini-3-flash-preview' ? 'gemini-3-flash-preview' as ModelId : 'gemini-2.5-flash' as ModelId,
    'gemini-2.5-flash' as ModelId,
  ];
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const messageContext = buildMessageContext(candidates, contextLimits.contentMaxLen);
      const history = getHistory(sessionId);
      const prompt = buildConversationPrompt(
        userQuery, history.slice(0, -1), messageContext,
        candidates.length, totalMessages, memSection,
        contextLimits.tokenBudgetHint
      );

      // Use fallback chain model on retry
      const retryModelId = FALLBACK_CHAIN[Math.min(attempt, FALLBACK_CHAIN.length - 1)];
      const activeModel = getModelInstance(retryModelId) || model;

      const result = await activeModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Parse JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Could not parse AI response as JSON');
      const parsed = JSON.parse(jsonMatch[0]);

      // Improved source matching — word-boundary aware to avoid false positives
      const replyLower = (parsed.reply || '').toLowerCase();
      const seenSourceIds = new Set<string>();
      const sources: ChatSource[] = candidates
        .filter(m => {
          const senderLower = (m.sender || '').toLowerCase().trim();
          const chatLower   = (m.chat_name || '').toLowerCase().trim();
          // Require min 3 chars AND word-boundary-ish match (space/punctuation before/after)
          const senderMatch = senderLower.length > 2 && (
            new RegExp(`\\b${senderLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(replyLower)
          );
          const chatMatch = chatLower.length > 2 && (
            new RegExp(`\\b${chatLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(replyLower)
          );
          return senderMatch || chatMatch;
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
        intent,
      };

      pushMessage(sessionId, assistantMsg, userId);
      // Background memory extraction — fire-and-forget
      extractAndSaveMemory(userId, userQuery, parsed.reply || '').catch(() => {});
      log.info('AI Chat response',
        `model=${attempt > 0 ? retryModelId : modelId} | query="${userQuery.slice(0, 40)}" | sources=${sources.length} | total=${totalMessages}`);

      const sessionTitle = sessionMetaStore.get(sessionId)?.title;
      const chatResult = { message: assistantMsg, conversationId: sessionId, sessionId, sessionTitle };

      // Cache the response (fire-and-forget)
      setCachedResponse(userQuery, userId, chatResult).catch(() => {});

      return chatResult;

    } catch (error: any) {
      lastError = error;
      const errMsg = error.message || '';
      const isQuota = /quota|rate.?limit|429|resource.?exhausted/i.test(errMsg);
      const isModel = /not.?found|invalid.?model|404/i.test(errMsg);
      log.error(`AI Chat attempt ${attempt + 1}/${MAX_RETRIES + 1} failed`, `${isQuota ? '[QUOTA] ' : isModel ? '[MODEL] ' : ''}${errMsg}`);
      if (attempt < MAX_RETRIES) {
        // Longer delay for quota errors, shorter for model errors
        const delay = isQuota ? 3000 * (attempt + 1) : 1000 * (attempt + 1);
        await new Promise(r => setTimeout(r, delay));
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
  | { done: true; sources: ChatSource[]; webSources?: WebSource[]; suggestions: string[]; stats: { messagesSearched: number; sourcesFound: number }; sessionId: string; sessionTitle?: string; model: string; intent?: QueryIntent };

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

  // Clean & search with HYBRID RAG retrieval
  const cleanedMessages = messages.map(cleanMessageContent);
  const keywords = extractKeywordsSync(userQuery);
  const dateRange = detectDateQuery(userQuery);
  const streamComplexity = detectQueryComplexity(userQuery, keywords.length);
  const streamContextLimits = getContextLimits(streamComplexity);

  let candidates: MessageData[];
  try {
    const retrievalResult = await hybridRetrieve(userQuery, cleanedMessages, {
      userId,
      maxResults: streamContextLimits.candidateLimit,
      dateRange: dateRange ? { start: new Date(dateRange.dateFrom), end: new Date(dateRange.dateTo) } : null,
    });
    candidates = retrievalResult.candidates.map(c => ({
      id: c.id,
      sender: c.sender,
      chat_name: c.chat_name,
      content: c.content,
      timestamp: c.timestamp,
      classification: c.classification,
      metadata: c.metadata,
    }));
    log.info('Stream hybrid retrieval',
      `vector=${retrievalResult.stats.vectorHits} keyword=${retrievalResult.stats.keywordHits} reranked=${retrievalResult.stats.afterRerank}`);
  } catch (err: any) {
    log.error('Stream hybrid retrieval failed, keyword fallback', err.message);
    if (keywords.length > 0 || dateRange) {
      candidates = searchByKeywords(keywords, cleanedMessages, streamContextLimits.candidateLimit, dateRange);
    } else {
      candidates = cleanedMessages.slice().sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      ).slice(0, streamContextLimits.candidateLimit).reverse();
    }
  }

  // Load memory + detect intent
  const streamMemory = await loadUserMemory(userId);
  const streamMemSection = buildMemorySection(streamMemory);
  const streamIntent = detectQueryIntent(userQuery, candidates.length);

  // Handle memory commands in stream mode
  if (streamIntent === 'memory') {
    const memReply = await handleMemoryUpdate(userId, userQuery);
    const memMsg: ChatMessage = {
      id: genId(), role: 'assistant', content: memReply,
      timestamp: new Date().toISOString(), sources: [], webSources: [],
      suggestions: ['What do you know about me?', 'Update my preferences', 'Forget everything about me'],
      stats: { messagesSearched: 0, sourcesFound: 0 }, model: modelId, intent: 'memory',
    };
    pushMessage(sessionId, memMsg, userId);
    onChunk({ delta: memReply, done: false });
    const mTitle = sessionMetaStore.get(sessionId)?.title;
    onChunk({ done: true, sources: [], webSources: [], suggestions: memMsg.suggestions!, stats: memMsg.stats!, sessionId, sessionTitle: mTitle, model: modelId, intent: 'memory' });
    return;
  }

  // Handle web search OR general knowledge queries in stream mode
  if (streamIntent === 'web' || streamIntent === 'general') {
    const historyForWebStream = getHistory(sessionId);
    const { reply: webReply, webSources, suggestions: webSuggestions } = await searchWeb(
      userQuery, historyForWebStream.slice(0, -1), streamMemory, modelId
    );
    const intentLabel = streamIntent === 'web' ? 'web' : 'general';
    const webMsg: ChatMessage = {
      id: genId(), role: 'assistant', content: webReply,
      timestamp: new Date().toISOString(), sources: [], webSources,
      suggestions: webSuggestions,
      stats: { messagesSearched: 0, sourcesFound: webSources.length }, model: modelId, intent: intentLabel,
    };
    pushMessage(sessionId, webMsg, userId);
    extractAndSaveMemory(userId, userQuery, webReply).catch(() => {});
    onChunk({ delta: webReply, done: false });
    const wTitle = sessionMetaStore.get(sessionId)?.title;
    onChunk({ done: true, sources: [], webSources, suggestions: webSuggestions, stats: webMsg.stats!, sessionId, sessionTitle: wTitle, model: modelId, intent: intentLabel });
    return;
  }

  const model = getModelInstance(modelId);
  if (!model) {
    onChunk({ done: true, sources: [], webSources: [], suggestions: [], stats: { messagesSearched: totalMessages, sourcesFound: 0 }, sessionId, model: modelId });
    return;
  }

  const history = getHistory(sessionId);
  const messageContext = buildMessageContext(candidates, streamContextLimits.contentMaxLen);
  // Use streaming-optimised prompt (plain markdown output, no JSON wrapper) with token budget
  const prompt = buildStreamingPrompt(
    userQuery, history.slice(0, -1), messageContext,
    candidates.length, totalMessages, streamMemSection,
    streamContextLimits.tokenBudgetHint
  );

  // Try streaming with improved fallback chain
  const STREAM_MAX_RETRIES = 2;
  const STREAM_FALLBACK_CHAIN: ModelId[] = [
    modelId,
    modelId !== 'gemini-3-flash-preview' ? 'gemini-3-flash-preview' as ModelId : 'gemini-2.5-flash' as ModelId,
    'gemini-2.5-flash' as ModelId,
  ];
  let lastStreamError: Error | null = null;

  for (let attempt = 0; attempt <= STREAM_MAX_RETRIES; attempt++) {
    try {
      const retryModelId = STREAM_FALLBACK_CHAIN[Math.min(attempt, STREAM_FALLBACK_CHAIN.length - 1)];
      const activeModel = getModelInstance(retryModelId) || model;
      if (attempt > 0) log.info('chatStream retry', `attempt=${attempt} model=${retryModelId}`);

      const result = await activeModel.generateContentStream(prompt);
      let fullText = '';

      for await (const chunk of result.stream) {
        if (signal?.aborted) break;
        const delta = chunk.text();
        if (delta) {
          fullText += delta;
          onChunk({ delta, done: false });
        }
      }

      // The streamed text is already plain markdown (no JSON wrapper to parse)
      const reply = fullText.trim();

      // Improved source matching — word-boundary aware to avoid false positives
      const replyLower = reply.toLowerCase();
      const seenIds = new Set<string>();
      const sources: ChatSource[] = candidates
        .filter(m => {
          const s = (m.sender || '').toLowerCase().trim();
          const c = (m.chat_name || '').toLowerCase().trim();
          const sMatch = s.length > 2 && new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(replyLower);
          const cMatch = c.length > 2 && new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(replyLower);
          return sMatch || cMatch;
        })
        .slice(0, 8)
        .map(m => buildSource(m, 'Mentioned in response'))
        .filter(s => {
          const k = s.messageKey || s.messageId;
          if (k && seenIds.has(k)) return false;
          if (k) seenIds.add(k);
          return true;
        });

      // Generate suggestions based on intent (no JSON parsing needed)
      const suggestions = generateSuggestions(userQuery, reply, streamIntent);

      const usedModel = retryModelId;
      const assistantMsg: ChatMessage = {
        id: genId(),
        role: 'assistant',
        content: reply,
        timestamp: new Date().toISOString(),
        sources,
        suggestions,
        stats: { messagesSearched: totalMessages, sourcesFound: sources.length },
        model: usedModel,
        intent: streamIntent,
      };
      pushMessage(sessionId, assistantMsg, userId);
      extractAndSaveMemory(userId, userQuery, reply).catch(() => {});

      const sessionTitle = sessionMetaStore.get(sessionId)?.title;
      onChunk({ done: true, sources, webSources: [], suggestions, stats: assistantMsg.stats!, sessionId, sessionTitle, model: usedModel, intent: streamIntent });
      return; // success — exit retry loop

    } catch (err: any) {
      if (signal?.aborted) return;
      lastStreamError = err;
      const errMsg = err.message || '';
      const isQuota = /quota|rate.?limit|429|resource.?exhausted/i.test(errMsg);
      log.error('chatStream attempt failed', `attempt=${attempt} ${isQuota ? '[QUOTA] ' : ''}error=${errMsg}`);
      if (attempt < STREAM_MAX_RETRIES) {
        const delay = isQuota ? 3000 * (attempt + 1) : 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
    }
  }

  // All retries exhausted — send error response with more helpful message
  log.error('chatStream all retries failed', lastStreamError?.message || 'unknown');
  const errDetail = lastStreamError?.message || 'Unknown error';
  onChunk({
    delta: `I wasn't able to generate a response after ${STREAM_MAX_RETRIES + 1} attempts. Error: *${errDetail}*\n\nPlease try again or switch to a different model.`,
    done: false,
  });
  onChunk({ done: true, sources: [], suggestions: ['Try again', 'Switch to Gemini 3 Flash', 'Show recent messages'], stats: { messagesSearched: totalMessages, sourcesFound: 0 }, sessionId, model: modelId });
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
