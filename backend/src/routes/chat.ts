/**
 * AI Chat Routes — RAG-powered conversational AI
 *
 * Features:
 *  - Multi-keyword RAG retrieval across the FULL message database
 *  - Privacy-aware: filters out blocked-sender messages before AI sees them
 *  - Task CRUD: create / complete / delete / list tasks via natural language
 *  - Dynamic model selection with user preference endpoints
 *  - Auto-retry on AI errors (handled in ai-chat service)
 */

import { Router, Request, Response } from 'express';
import {
  chat,
  chatStream,
  getChatHistory,
  clearChatHistory,
  ensureChatHistoryLoaded,
  initChatAI,
  detectTaskIntent,
  detectDateQuery,
  AVAILABLE_MODELS,
  setUserModel,
  getUserModel,
  createSession,
  listSessionsFromDb,
  deleteSession,
  renameSession,
  getUserMemoryAll,
  loadUserMemory,
  saveUserMemoryFact,
  deleteUserMemoryFact,
  TaskActionResult,
  ModelId,
} from '../services/ai-chat';
import { hybridMessageStore } from '../services/hybrid-message-store';
import { hybridActionItems } from '../services/hybrid-action-items';
import { getBlockedSenders } from '../services/privacy-settings';
import log from '../services/activity-log';

const router = Router();

// Initialize AI chat on module load
initChatAI();

// ── Per-user rate limiting ───────────────────────────────────────────────────

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX       = 15;     // requests per minute per user

interface RateLimitEntry { count: number; resetAt: number; }
const rateLimitStore = new Map<string, RateLimitEntry>();

function checkRateLimit(userId: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(userId);
  if (!entry || now >= entry.resetAt) {
    rateLimitStore.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count++;
  return { allowed: true, retryAfterSec: 0 };
}

// ── Stop words for keyword extraction ───────────────────────────────────────

const STOP_WORDS = new Set([
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

function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !STOP_WORDS.has(w));
}

// ── Privacy: filter out blocked-sender messages ─────────────────────────────

async function filterPrivateMessages(
  messages: any[],
  userId: string,
  jwt?: string,
): Promise<any[]> {
  // Only remove newsletter/channel spam and explicitly blocked senders.
  // DO NOT filter on classification='private' — that just means it's a personal/DM chat,
  // and the user absolutely wants their own AI to see their personal messages.
  let filtered = messages.filter(m => {
    if (m.metadata?.private === true) return false;
    // Remove newsletter / channel messages (they flood AI with spam)
    const sender: string = m.sender || '';
    const chatName: string = m.chat_name || '';
    if (sender.endsWith('@newsletter')) return false;
    if (chatName.endsWith('@newsletter')) return false;
    if (sender.includes('@newsletter')) return false;
    return true;
  });

  // 2. Also check against the user's blocked-sender list
  try {
    const blocked = await getBlockedSenders(userId, jwt);
    if (blocked.length > 0) {
      const blockedJids = new Set(blocked.map(b => b.jid));
      const blockedBare = new Set(blocked.map(b => b.jid.split('@')[0]));

      filtered = filtered.filter(m => {
        const sender: string = m.sender || '';
        const chatName: string = m.chat_name || '';
        const senderBare = sender.split('@')[0];

        // Check if sender or chat matches any blocked entry
        for (const jid of blockedJids) {
          if (sender === jid || chatName === jid) return false;
        }
        for (const bare of blockedBare) {
          if (senderBare === bare || sender.includes(bare) || chatName.includes(bare)) return false;
        }
        return true;
      });
    }
  } catch {
    // If privacy check fails, continue with what we have
  }

  return filtered;
}

// ── Task CRUD via chat ──────────────────────────────────────────────────────

async function handleTaskAction(
  query: string,
  userId: string,
  jwt?: string,
): Promise<TaskActionResult | null> {
  const intent = detectTaskIntent(query);

  if (intent.action === 'none') return null;

  try {
    switch (intent.action) {
      case 'create': {
        if (!intent.title) {
          return { action: 'none', error: 'Please specify a task title. Example: "Create task: Buy groceries"' };
        }
        const item = await hybridActionItems.add({
          messageId: null,
          title: intent.title,
          description: null,
          sender: null,
          chatName: null,
          priority: (intent.priority as any) || 'medium',
          status: 'pending',
          category: (intent.category as any) || 'other',
          dueDate: null,
          dueTime: null,
          tags: [],
          originalMessage: query,
          aiConfidence: 1.0,
          completedAt: null,
        }, userId, jwt);
        return { action: 'created', taskId: item.id, taskTitle: item.title };
      }

      case 'complete': {
        const { data: tasks } = await hybridActionItems.getAll({
          status: 'pending',
          userId,
          jwt,
          limit: 100,
        });
        const searchLower = (intent.searchTerm || '').toLowerCase();
        const match = tasks.find(t =>
          t.title.toLowerCase().includes(searchLower) ||
          (t.description && t.description.toLowerCase().includes(searchLower))
        );
        if (!match) {
          return { action: 'none', error: `No pending task found matching "${intent.searchTerm}"` };
        }
        const completed = await hybridActionItems.complete(match.id, userId, jwt);
        return {
          action: 'completed',
          taskId: match.id,
          taskTitle: completed?.title || match.title,
        };
      }

      case 'delete': {
        const { data: allTasks } = await hybridActionItems.getAll({
          userId,
          jwt,
          limit: 100,
        });
        const delSearch = (intent.searchTerm || '').toLowerCase();
        const delMatch = allTasks.find(t =>
          t.title.toLowerCase().includes(delSearch) ||
          (t.description && t.description.toLowerCase().includes(delSearch))
        );
        if (!delMatch) {
          return { action: 'none', error: `No task found matching "${intent.searchTerm}"` };
        }
        await hybridActionItems.delete(delMatch.id, userId, jwt);
        return { action: 'deleted', taskId: delMatch.id, taskTitle: delMatch.title };
      }

      case 'list': {
        const { data: listTasks } = await hybridActionItems.getAll({
          userId,
          jwt,
          limit: 50,
        });
        // Return listed — the AI response will format the tasks
        return {
          action: 'listed',
          taskTitle: listTasks.length > 0
            ? listTasks.map(t => `• [${t.status}] ${t.title} (${t.priority})`).join('\n')
            : 'No tasks found.',
        };
      }

      default:
        return null;
    }
  } catch (err: any) {
    return { action: 'none', error: err.message || 'Task action failed' };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  Routes
// ══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/chat/models
 * List available AI models and the user's current preference.
 */
router.get('/models', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const currentModel = getUserModel(userId);
    res.json({
      success: true,
      data: {
        models: AVAILABLE_MODELS,
        currentModel,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/chat/model
 * Set the user's preferred AI model.
 * Body: { modelId: string }
 */
router.put('/model', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { modelId } = req.body;

    if (!modelId || typeof modelId !== 'string') {
      return res.status(400).json({ success: false, error: 'modelId is required' });
    }

    const ok = setUserModel(userId, modelId);
    if (!ok) {
      return res.status(400).json({
        success: false,
        error: `Invalid model. Available: ${AVAILABLE_MODELS.map(m => m.id).join(', ')}`,
      });
    }

    log.info('Model changed', `User ${userId} → ${modelId}`);
    res.json({ success: true, data: { modelId } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/chat
 * Send a message and receive an AI response.
 * Uses multi-keyword RAG retrieval + privacy filtering + task CRUD.
 *
 * Body: { message: string, modelId?: string }
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { message, modelId } = req.body;
    const userId = req.userId!;
    const jwt = req.supabaseToken;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    if (message.length > 2000) {
      return res.status(400).json({ success: false, error: 'Message too long (max 2000 characters)' });
    }

    log.info('AI Chat message', `"${message.slice(0, 50)}…"`);

    // ── Rate limiting ───────────────────────────────────────
    const rl = checkRateLimit(userId);
    if (!rl.allowed) {
      return res.status(429).json({
        success: false,
        error: `Too many requests. Please wait ${rl.retryAfterSec} seconds before trying again.`,
      });
    }

    // ── Task action detection ────────────────────────────────────────────
    const taskAction = await handleTaskAction(message.trim(), userId, jwt);

    // ── RAG Retrieval (D1 fix): keyword-filtered queries instead of 2000-row scan ──
    // Always load the 300 most-recent messages (fresh context), then supplement with
    // keyword-filtered search so relevant older messages are also included.
    const queryKeywords = extractKeywords(message.trim());
    const seen = new Set<string>();
    const allMessages: any[] = [];
    let totalInDb = 0;

    try {
      const { data: recent, total } = await hybridMessageStore.getAll({
        limit: 300,
        userId,
        jwt,
      });
      totalInDb = total;
      for (const m of recent) { seen.add(m.id); allMessages.push(m); }
    } catch { /* continue */ }

    // Keyword-filtered supplemental query for relevant older messages
    if (queryKeywords.length > 0) {
      try {
        const { data: kwMatches, total } = await hybridMessageStore.getAll({
          search: queryKeywords.slice(0, 6).join(' '),
          limit: 400,
          userId,
          jwt,
        });
        if (total > totalInDb) totalInDb = total;
        for (const m of kwMatches) {
          if (!seen.has(m.id)) { seen.add(m.id); allMessages.push(m); }
        }
      } catch { /* continue */ }
    }

    // ── Privacy filter: remove blocked-sender messages ───────────────────
    const safeMessages = await filterPrivateMessages(allMessages, userId, jwt);

    log.info('RAG retrieval (final)',
      `total=${safeMessages.length} | afterNewsletter+privacy | totalInDb=${totalInDb}`);

    // Resolve sessionId
    let sessionId: string = req.body.sessionId || '';
    if (!sessionId) {
      const newSession = createSession(userId);
      sessionId = newSession.sessionId;
    } else {
      await ensureChatHistoryLoaded(sessionId, userId);
    }

    // ── AI Generation ────────────────────────────────────────────────────
    const modelOverride = modelId as ModelId | undefined;
    const chatResponse = await chat(message.trim(), safeMessages, userId, sessionId, totalInDb, modelOverride);

    // Attach task action result to the response if one was performed
    if (taskAction && taskAction.action !== 'none') {
      chatResponse.message.taskAction = taskAction;
    }

    res.json({ success: true, data: chatResponse });
  } catch (error: any) {
    log.error('AI Chat error', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/chat/stream
 * Same as POST /api/chat but streams the response as Server-Sent Events.
 * Each event is a JSON chunk: `data: {"delta":"...",...}\n\n`
 * Final event: `data: {"done":true,"sources":[...],...}\n\n`
 */
router.post('/stream', async (req: Request, res: Response) => {
  try {
    const { message, modelId } = req.body;
    const userId = req.userId!;
    const jwt = req.supabaseToken;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ success: false, error: 'Message too long (max 2000 characters)' });
    }

    const rl = checkRateLimit(userId);
    if (!rl.allowed) {
      return res.status(429).json({
        success: false,
        error: `Too many requests. Please wait ${rl.retryAfterSec} seconds before trying again.`,
      });
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Abort controller for client disconnect
    const abortCtrl = new AbortController();
    req.on('close', () => abortCtrl.abort());

    // Task action
    const taskAction = await handleTaskAction(message.trim(), userId, jwt);

    // Fetch messages (same D1-fixed logic as POST /)
    const queryKeywords = extractKeywords(message.trim());
    const seen = new Set<string>();
    const allMessages: any[] = [];
    let totalInDb = 0;

    try {
      const { data: recent, total } = await hybridMessageStore.getAll({ limit: 300, userId, jwt });
      totalInDb = total;
      for (const m of recent) { seen.add(m.id); allMessages.push(m); }
    } catch {}

    if (queryKeywords.length > 0) {
      try {
        const { data: kwMatches, total } = await hybridMessageStore.getAll({
          search: queryKeywords.slice(0, 6).join(' '), limit: 400, userId, jwt,
        });
        if (total > totalInDb) totalInDb = total;
        for (const m of kwMatches) { if (!seen.has(m.id)) { seen.add(m.id); allMessages.push(m); } }
      } catch {}
    }

    const safeMessages = await filterPrivateMessages(allMessages, userId, jwt);

    // Session
    let sessionId: string = req.body.sessionId || '';
    if (!sessionId) {
      const newSession = createSession(userId);
      sessionId = newSession.sessionId;
    } else {
      await ensureChatHistoryLoaded(sessionId, userId);
    }

    const modelOverride = modelId as ModelId | undefined;

    await chatStream(
      message.trim(),
      safeMessages,
      userId,
      sessionId,
      totalInDb,
      modelOverride,
      (chunk) => {
        if (abortCtrl.signal.aborted) return;
        // Attach taskAction to the done chunk
        if ((chunk as any).done && taskAction && taskAction.action !== 'none') {
          (chunk as any).taskAction = taskAction;
        }
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      },
      abortCtrl.signal,
    );

    res.end();
  } catch (error: any) {
    log.error('AI Chat stream error', error.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    } else {
      res.write(`data: ${JSON.stringify({ done: true, error: error.message })}\n\n`);
      res.end();
    }
  }
});

/**
 * GET /api/chat/sessions
 * List all sessions for the current user.
 */
router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const sessions = await listSessionsFromDb(userId);
    res.json({ success: true, data: sessions });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/chat/sessions
 * Create a new chat session.
 */
router.post('/sessions', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { title } = req.body;
    const session = createSession(userId, title || 'New Chat');
    res.json({ success: true, data: session });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/chat/sessions/:id
 * Delete a session and its history.
 */
router.delete('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const ok = await deleteSession(req.params.id, userId);
    if (!ok) return res.status(403).json({ success: false, error: 'Session not found or access denied' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /api/chat/sessions/:id
 * Rename a session.
 */
router.patch('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { title } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'title is required' });
    const ok = renameSession(req.params.id, title, userId);
    if (!ok) return res.status(403).json({ success: false, error: 'Session not found or access denied' });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/chat/history
 * Retrieve history for a specific session.
 */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const sessionId = (req.query.sessionId as string) || '';
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId query param is required' });
    }
    await ensureChatHistoryLoaded(sessionId, userId);
    const history = getChatHistory(sessionId);
    res.json({
      success: true,
      data: { sessionId, messages: history, messageCount: history.length },
    });
  } catch (error: any) {
    log.error('Chat history error', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/chat/history
 * Clear history for a specific session.
 */
router.delete('/history', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const sessionId = (req.query.sessionId as string) || '';
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId query param is required' });
    }
    await clearChatHistory(sessionId, userId);
    res.json({ success: true, message: 'Conversation cleared' });
  } catch (error: any) {
    log.error('Clear chat history error', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── Memory Management Endpoints ──────────────────────────────────────────────

/**
 * GET /api/chat/memory
 * List all remembered facts for the current user.
 */
router.get('/memory', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const facts = await getUserMemoryAll(userId);
    res.json({ success: true, data: { facts, count: facts.length } });
  } catch (error: any) {
    log.error('Get memory error', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/chat/memory
 * Manually save a memory fact. Body: { key: string, value: string }
 */
router.post('/memory', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { key, value } = req.body;
    if (!key || !value) return res.status(400).json({ success: false, error: 'key and value are required' });
    if (typeof key !== 'string' || typeof value !== 'string') {
      return res.status(400).json({ success: false, error: 'key and value must be strings' });
    }
    await saveUserMemoryFact(userId, key.trim().slice(0, 100), value.trim().slice(0, 500), 'manual');
    res.json({ success: true, message: `Saved: ${key} = ${value}` });
  } catch (error: any) {
    log.error('Save memory error', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/chat/memory
 * Clear all memory facts for the current user. Optional ?key=xxx to delete one.
 */
router.delete('/memory', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const key = req.query.key as string | undefined;
    if (key) {
      await deleteUserMemoryFact(userId, key);
      res.json({ success: true, message: `Deleted memory fact: ${key}` });
    } else {
      // Clear all: load all facts and delete them one by one
      const facts = await getUserMemoryAll(userId);
      await Promise.all(facts.map(f => deleteUserMemoryFact(userId, f.key)));
      res.json({ success: true, message: `Cleared ${facts.length} memory facts` });
    }
  } catch (error: any) {
    log.error('Delete memory error', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── Embedding backfill & stats ──────────────────────────────────────────────

/**
 * POST /api/chat/embeddings/backfill
 * Backfill embeddings for messages that don't have them yet.
 */
router.post('/embeddings/backfill', async (req: Request, res: Response) => {
  try {
    const userId = req.userId!;
    const { backfillEmbeddings, getEmbeddingStats } = await import('../services/embedding-service');
    const result = await backfillEmbeddings(userId);
    const stats = getEmbeddingStats();
    res.json({
      success: true,
      backfill: result,
      embeddingService: stats,
    });
  } catch (error: any) {
    log.error('Backfill embeddings error', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/chat/embeddings/stats
 * Get embedding service stats (cache size, model info).
 */
router.get('/embeddings/stats', async (req: Request, res: Response) => {
  try {
    const { getEmbeddingStats } = await import('../services/embedding-service');
    const { getCacheStats } = await import('../services/response-cache');
    res.json({
      success: true,
      embeddings: getEmbeddingStats(),
      responseCache: getCacheStats(),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
