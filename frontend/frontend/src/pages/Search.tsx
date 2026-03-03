/**
 * AI Chat — Conversational AI over WhatsApp & Gmail messages
 *
 * App-native Notion-style design with:
 *  - File/document reference cards (Claude-style)
 *  - RAG-powered full-database retrieval
 *  - Source citations with Dashboard-style cards
 *  - Multi-turn conversation with memory
 *  - Typewriter animation, auto-scroll, keyboard shortcuts
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Sparkles,
  MessageSquare,
  Send,
  Loader2,
  AlertCircle,
  FileText,
  Download,
  Trash2,
  ChevronDown,
  Bot,
  Zap,
  Calendar,
  ListTodo,
  TrendingUp,
  Search,
  Paperclip,
  ExternalLink,
  ImageIcon,
  Video,
  Music,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Cpu,
  Plus,
  MessagesSquare,
  Copy,
  Check,
  RotateCcw,
  Edit3,
  Menu,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { API_BASE, authFetch } from '../services/api'

/* ── Types ──────────────────────────────────────────────────────────────── */

interface ChatSource {
  messageId: string
  sender: string
  chatName: string
  content: string
  timestamp: string
  matchReason: string
  mediaType?: string | null
  messageKey?: string | null
  hasMedia?: boolean
  documentName?: string | null
  imageDescription?: string | null
  documentSummary?: string | null
}

interface TaskActionResult {
  action: 'created' | 'completed' | 'deleted' | 'listed' | 'none'
  taskId?: string
  taskTitle?: string
  error?: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  sources?: ChatSource[]
  suggestions?: string[]
  stats?: { messagesSearched: number; sourcesFound: number }
  model?: string
  retryCount?: number
  taskAction?: TaskActionResult
}

interface ModelInfo {
  id: string
  label: string
  tier: string
}

interface ChatSession {
  sessionId: string
  title: string
  createdAt: string
  lastMessageAt: string
  messageCount: number
}

/* ── Fallback model list (shown before API loads or if API fails) ────────── */
const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro',        tier: 'premium' },
  { id: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash',      tier: 'fast'    },
  { id: 'gemini-2.0-flash',      label: 'Gemini 2.0 Flash',      tier: 'fast'    },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite', tier: 'fast'    },
]

/* ── Conversation starters ──────────────────────────────────────────────── */

const STARTERS = [
  { icon: TrendingUp, label: 'Summarize today',   query: 'Summarize all my messages from today — key conversations, tasks, and anything important.' },
  { icon: ListTodo,   label: 'Find my tasks',     query: 'What tasks, to-do items, deadlines, or action items can you find in my recent messages?' },
  { icon: Calendar,   label: 'Upcoming events',   query: 'Find all upcoming meetings, calls, appointments, and scheduled events from my messages.' },
  { icon: Paperclip,  label: 'Files & media',     query: 'Show me all the images, documents, and files that were shared in my messages recently.' },
  { icon: Search,     label: 'Important messages', query: 'What are the most important or urgent messages I received recently?' },
  { icon: Zap,        label: 'Insights & patterns', query: 'What patterns or interesting insights can you find in my recent conversations?' },
]

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function getFileIcon(mediaType: string | null | undefined) {
  switch (mediaType) {
    case 'image':    return ImageIcon
    case 'video':    return Video
    case 'audio':    return Music
    default:         return FileText
  }
}

function getFileIconColor(mediaType: string | null | undefined) {
  switch (mediaType) {
    case 'image':    return 'text-blue-500 bg-blue-50 dark:bg-blue-900/30'
    case 'video':    return 'text-purple-500 bg-purple-50 dark:bg-purple-900/30'
    case 'audio':    return 'text-green-500 bg-green-50 dark:bg-green-900/30'
    default:         return 'text-amber-500 bg-amber-50 dark:bg-amber-900/30'
  }
}

function getTypeBadge(source: ChatSource): string {
  if (source.documentName) {
    const ext = source.documentName.split('.').pop()?.toUpperCase()
    if (ext && ext.length <= 5) return ext
  }
  switch (source.mediaType) {
    case 'image':    return 'IMAGE'
    case 'video':    return 'VIDEO'
    case 'audio':    return 'AUDIO'
    case 'document': return 'DOC'
    case 'sticker':  return 'STICKER'
    default:         return 'FILE'
  }
}

function formatTime(ts: string) {
  try {
    const d = new Date(ts)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const hrs = diff / 36e5
    if (hrs < 1) { const m = Math.floor(diff / 6e4); return m <= 1 ? 'Just now' : `${m}m ago` }
    if (hrs < 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (hrs < 48) return 'Yesterday'
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  } catch { return ts }
}

function fmtSourceDate(ts: string) {
  try {
    const d = new Date(ts)
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return ts }
}

/* ── Typewriter hook ──────────────────────────────────────────────────────── */

function useTypewriter(text: string, speed = 12, enabled = true) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!enabled) { setDisplayed(text); setDone(true); return }
    setDisplayed(''); setDone(false)
    let i = 0
    const iv = setInterval(() => {
      const chunk = Math.min(3, text.length - i)
      i += chunk
      setDisplayed(text.slice(0, i))
      if (i >= text.length) { setDone(true); clearInterval(iv) }
    }, speed)
    return () => clearInterval(iv)
  }, [text, speed, enabled])

  return { displayed, done }
}

/* ── Inline markdown ─────────────────────────────────────────────────────── */

/** Escape HTML entities to prevent XSS via dangerouslySetInnerHTML */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function inlineFmt(t: string): string {
  // First escape HTML, then apply safe markdown transformations
  const safe = escapeHtml(t)
  return safe
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="px-1 py-0.5 bg-[var(--bg-surface-soft)] rounded text-xs font-mono">$1</code>')
}

function renderMd(text: string) {
  return text.split('\n').map((line, i) => {
    if (line.match(/^[-•]\s/)) {
      const c = line.replace(/^[-•]\s/, '')
      return (
        <div key={i} className="flex items-start gap-2 ml-1 my-0.5">
          <span className="mt-2 w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] flex-shrink-0" />
          <span dangerouslySetInnerHTML={{ __html: inlineFmt(c) }} />
        </div>
      )
    }
    if (line.trim() === '') return <div key={i} className="h-2" />
    return <p key={i} className="my-0.5" dangerouslySetInnerHTML={{ __html: inlineFmt(line) }} />
  })
}

/* ── File card (Claude-style document card) ──────────────────────────────── */

// Media URLs don't require auth (optionalAuth middleware), so we can use direct URLs.
// This avoids CORS/blob-URL issues and works across tabs/sessions.
function getDirectMediaUrl(key: string) {
  return `${API_BASE}/whatsapp/media/${encodeURIComponent(key)}`
}

function FileCard({
  source,
  onDownload,
}: {
  source: ChatSource
  onDownload: (key: string, name?: string) => void
}) {
  const Icon = getFileIcon(source.mediaType)
  const iconColor = getFileIconColor(source.mediaType)
  const badge = getTypeBadge(source)
  const isImage = source.mediaType === 'image'
  const name = source.documentName ||
    (source.mediaType === 'image' ? 'Image' :
     source.mediaType === 'video' ? 'Video' :
     source.mediaType === 'audio' ? 'Audio recording' : 'Attachment')

  const [imgError, setImgError] = useState(false)
  const directUrl = source.messageKey ? getDirectMediaUrl(source.messageKey) : null

  const handleCardClick = () => {
    if (!source.messageKey) return
    if (isImage && directUrl) window.open(directUrl, '_blank')
    else if (!isImage) onDownload(source.messageKey!, source.documentName || undefined)
  }

  return (
    <div
      onClick={source.messageKey ? handleCardClick : undefined}
      className={clsx(
        'flex-shrink-0 w-[168px] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-soft)] overflow-hidden transition-all group',
        source.messageKey && 'cursor-pointer hover:border-[var(--accent-primary)] hover:shadow-sm'
      )}
    >
      {/* Image thumbnail — uses direct URL, no auth needed */}
      {isImage && directUrl && (
        <div className="w-full h-[80px] bg-[var(--bg-surface)] flex items-center justify-center overflow-hidden">
          {imgError ? (
            <div className="flex flex-col items-center gap-1 px-2">
              <ImageIcon className="w-5 h-5 text-[var(--text-muted)]" />
              <span className="text-[9px] text-[var(--text-muted)] text-center leading-tight">Expired — re-receive<br/>to reload</span>
            </div>
          ) : (
            <img
              src={directUrl}
              alt={name}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          )}
        </div>
      )}

      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-1">
          {!isImage && (
            <div className={clsx('w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0', iconColor)}>
              <Icon className="w-3 h-3" />
            </div>
          )}
          <p className="text-xs font-semibold text-[var(--text-primary)] truncate leading-tight flex-1">{name}</p>
        </div>
        <p className="text-[10px] text-[var(--text-muted)] truncate mb-2">
          {source.sender} · {fmtSourceDate(source.timestamp).split(' · ')[0]}
        </p>
        <div className="flex items-center justify-between gap-1">
          <span className="text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-subtle)] uppercase">
            {badge}
          </span>
          {source.messageKey && directUrl && (
            <div className="flex items-center gap-0.5">
              {isImage && (
                <button
                  onClick={(e) => { e.stopPropagation(); window.open(directUrl, '_blank') }}
                  className="p-1 rounded-md hover:bg-[var(--accent-light)] text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-all"
                  title="Open in new tab"
                >
                  <ExternalLink className="w-3 h-3" />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onDownload(source.messageKey!, source.documentName || undefined) }}
                className="p-1 rounded-md hover:bg-[var(--accent-light)] text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-all"
                title="Download"
              >
                <Download className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Source list (collapsible) ────────────────────────────────────────────── */

function SourceList({
  sources,
  onDownload,
}: {
  sources: ChatSource[]
  onDownload: (key: string, name?: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (!sources.length) return null

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent-primary)] hover:underline"
      >
        <ChevronDown className={clsx('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
        {open ? 'Hide' : 'View'} {sources.length} source{sources.length !== 1 ? 's' : ''}
      </button>

      {open && (
        <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto">
          {sources.map((s, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 p-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] hover:bg-[var(--bg-surface-soft)] transition-colors text-xs"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-semibold text-[var(--text-primary)]">{s.sender}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">{fmtSourceDate(s.timestamp)}</span>
                </div>
                <p className="text-[var(--text-secondary)] line-clamp-2 leading-relaxed">
                  {s.content.length > 160 ? s.content.slice(0, 160) + '\u2026' : s.content}
                </p>
                {s.imageDescription && (
                  <p className="text-[10px] text-blue-500 italic mt-0.5 line-clamp-1">
                    Image: {s.imageDescription}
                  </p>
                )}
                {s.documentSummary && (
                  <p className="text-[10px] text-amber-500 italic mt-0.5 line-clamp-1">
                    Doc: {s.documentSummary}
                  </p>
                )}
                <p className="text-[10px] text-[var(--text-muted)] mt-1 flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" />{s.matchReason}
                </p>
              </div>
              {s.hasMedia && s.messageKey && (
                <div className="shrink-0 flex items-center gap-1">
                  {s.mediaType === 'image' && (
                    <button
                      onClick={() => window.open(getDirectMediaUrl(s.messageKey!), '_blank')}
                      className="p-1.5 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--accent-primary)] hover:bg-[var(--accent-light)] text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-all"
                      title="Open image"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => onDownload(s.messageKey!, s.documentName || undefined)}
                    className="p-1.5 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--accent-primary)] hover:bg-[var(--accent-light)] text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-all"
                    title="Download"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── User bubble ─────────────────────────────────────────────────────────── */

function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%]">
        <p className="text-[10px] text-[var(--text-muted)] text-right mb-1">{formatTime(message.timestamp)}</p>
        <div className="bg-[var(--accent-primary)] text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed">
          {message.content}
        </div>
      </div>
    </div>
  )
}

/* ── AI bubble with file cards ───────────────────────────────────────────── */

function AiBubble({
  message,
  isLatest,
  isStreaming,
  onSuggestion,
  onDownload,
  onRegenerate,
}: {
  message: ChatMessage
  isLatest: boolean
  isStreaming?: boolean
  onSuggestion: (q: string) => void
  onDownload: (key: string, name?: string) => void
  onRegenerate?: () => void
}) {
  // When streaming is active, show real-time content without typewriter.
  // Typewriter only plays once for the final completed response.
  const shouldAnimate = isLatest && !isStreaming
  const { displayed, done: twDone } = useTypewriter(message.content, 8, shouldAnimate)
  const text = isStreaming ? message.content : (shouldAnimate ? displayed : message.content)
  // Consider the bubble "done" when stats arrive (streaming complete) or typewriter finishes
  const done = isStreaming ? !!message.stats : twDone
  const [copied, setCopied] = useState(false)

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }, [message.content])

  // Deduplicate file cards by messageKey / messageId
  const seenFileKeys = new Set<string>()
  const fileCards = (message.sources?.filter(s => {
    if (!(s.hasMedia || s.documentName)) return false
    const k = s.messageKey || s.messageId
    if (!k || seenFileKeys.has(k)) return false
    seenFileKeys.add(k)
    return true
  }) || [])

  return (
    <div className="flex items-start gap-3">
      {/* AI icon */}
      <div className="w-7 h-7 rounded-lg bg-[var(--accent-light)] flex items-center justify-center flex-shrink-0 mt-0.5">
        <Bot className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        {/* Label + time + model badge */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-[var(--text-primary)]">Mindline AI</span>
          <span className="text-[10px] text-[var(--text-muted)]">{formatTime(message.timestamp)}</span>
          {message.model && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--bg-surface-soft)] border border-[var(--border-subtle)] text-[9px] font-medium text-[var(--text-muted)]">
              <Cpu className="w-2.5 h-2.5" />
              {message.model.replace('gemini-', '').replace('-preview', '').replace(/-\d{2}-\d{2}$/, '')}
            </span>
          )}
          {message.retryCount && message.retryCount > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-[9px] font-medium text-amber-600 dark:text-amber-400">
              <RefreshCw className="w-2.5 h-2.5" />
              Retried {message.retryCount}x
            </span>
          )}
        </div>

        {/* ── Task action feedback ──────────────────────────────────── */}
        {message.taskAction && message.taskAction.action !== 'none' && done && (
          <div className={clsx(
            'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium',
            message.taskAction.action === 'created' && 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400',
            message.taskAction.action === 'completed' && 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400',
            message.taskAction.action === 'deleted' && 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400',
            message.taskAction.action === 'listed' && 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-400',
          )}>
            {message.taskAction.action === 'created' && <CheckCircle2 className="w-3.5 h-3.5" />}
            {message.taskAction.action === 'completed' && <CheckCircle2 className="w-3.5 h-3.5" />}
            {message.taskAction.action === 'deleted' && <XCircle className="w-3.5 h-3.5" />}
            {message.taskAction.action === 'listed' && <ListTodo className="w-3.5 h-3.5" />}
            <span>
              {message.taskAction.action === 'created' && `Task created: ${message.taskAction.taskTitle}`}
              {message.taskAction.action === 'completed' && `Task completed: ${message.taskAction.taskTitle}`}
              {message.taskAction.action === 'deleted' && `Task deleted: ${message.taskAction.taskTitle}`}
              {message.taskAction.action === 'listed' && 'Tasks listed below'}
            </span>
          </div>
        )}
        {message.taskAction && message.taskAction.error && done && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-xs font-medium text-amber-600 dark:text-amber-400">
            <AlertCircle className="w-3.5 h-3.5" />
            {message.taskAction.error}
          </div>
        )}

        {/* ── File cards row (Claude-style) ─────────────────────────── */}
        {fileCards.length > 0 && done && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {fileCards.map((src, i) => (
              <FileCard key={i} source={src} onDownload={onDownload} />
            ))}
          </div>
        )}

        {/* ── Response text ─────────────────────────────────────────── */}
        <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed text-[var(--text-primary)]">
          <div className="space-y-0.5">
            {renderMd(text)}
            {(isStreaming || (shouldAnimate && !done)) && (
              <span className="inline-block w-1.5 h-4 bg-[var(--accent-primary)] animate-pulse rounded-sm ml-0.5" />
            )}
          </div>
        </div>

        {/* ── Copy / Regenerate toolbar ──────────────────────────────── */}
        {done && (
          <div className="flex items-center gap-1 -mt-1">
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--accent-primary)] hover:bg-[var(--bg-surface-soft)] rounded-md transition-colors"
              title="Copy response"
            >
              {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[var(--text-muted)] hover:text-[var(--accent-primary)] hover:bg-[var(--bg-surface-soft)] rounded-md transition-colors"
                title="Regenerate response"
              >
                <RotateCcw className="w-3 h-3" />
                Retry
              </button>
            )}
          </div>
        )}

        {/* Sources */}
        {message.sources && done && (
          <SourceList sources={message.sources} onDownload={onDownload} />
        )}

        {/* Suggestion chips */}
        {message.suggestions && message.suggestions.length > 0 && done && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {message.suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => onSuggestion(s)}
                className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-full hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] hover:bg-[var(--accent-light)] transition-all"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   Main page
   ════════════════════════════════════════════════════════════════════════════ */

export default function SearchPage() {
  const [input, setInput]       = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [initialized, setInit]  = useState(false)
  const endRef   = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)
  const abortRef  = useRef<AbortController | null>(null)
  const streamingIdRef = useRef<string | null>(null)

  /* Session state */
  const [sessions, setSessions]           = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')

  /* Model selection state — seed with fallback so dropdown always shows */
  const [models, setModels]             = useState<ModelInfo[]>(FALLBACK_MODELS)
  const [currentModel, setCurrentModel] = useState<string>('gemini-2.5-flash')
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  /* Auto-scroll */
  const scrollEnd = useCallback(() => {
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 80)
  }, [])
  useEffect(() => { scrollEnd() }, [messages, scrollEnd])

  /* Load sessions + models on mount */
  useEffect(() => {
    (async () => {
      try {
        const [sessR, modR] = await Promise.all([
          authFetch(`${API_BASE}/chat/sessions`),
          authFetch(`${API_BASE}/chat/models`),
        ])
        if (sessR.ok) {
          const d = await sessR.json()
          if (d.success && Array.isArray(d.data)) {
            setSessions(d.data)
            if (d.data.length > 0) {
              // Load the most recent session's history
              const latest = d.data[0]
              setCurrentSessionId(latest.sessionId)
              const histR = await authFetch(`${API_BASE}/chat/history?sessionId=${latest.sessionId}`)
              if (histR.ok) {
                const hd = await histR.json()
                if (hd.success && hd.data.messages.length) setMessages(hd.data.messages)
              }
            }
          }
        }
        if (modR.ok) {
          const d = await modR.json()
          if (d.success) {
            setModels(d.data.models)
            setCurrentModel(d.data.currentModel)
          }
        }
      } catch {
        // Start fresh
      } finally {
        setInit(true)
      }
    })()
  }, [])

  /* Switch to a different session */
  const switchSession = useCallback(async (sessionId: string) => {
    if (sessionId === currentSessionId) return
    setMessages([])
    setError(null)
    setCurrentSessionId(sessionId)
    try {
      const r = await authFetch(`${API_BASE}/chat/history?sessionId=${sessionId}`)
      if (r.ok) {
        const d = await r.json()
        if (d.success) setMessages(d.data.messages || [])
      }
    } catch {}
  }, [currentSessionId])

  /* Create a new session */
  const newSession = useCallback(async () => {
    try {
      const r = await authFetch(`${API_BASE}/chat/sessions`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'New Chat' })
      })
      if (r.ok) {
        const d = await r.json()
        if (d.success) {
          setSessions(p => [d.data, ...p])
          setCurrentSessionId(d.data.sessionId)
          setMessages([])
          setError(null)
        }
      }
    } catch {}
  }, [])

  /* Delete a session — A2 fix: switchSession called OUTSIDE state updater */
  const deleteSession = useCallback(async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this chat session? This cannot be undone.')) return
    try {
      await authFetch(`${API_BASE}/chat/sessions/${sessionId}`, { method: 'DELETE' })
      setSessions(p => p.filter(s => s.sessionId !== sessionId))
      if (currentSessionId === sessionId) {
        // A2 fix: read sessions directly (not inside a setState updater) and switch outside
        const remaining = sessions.filter(s => s.sessionId !== sessionId)
        if (remaining.length > 0) {
          switchSession(remaining[0].sessionId)
        } else {
          setMessages([])
          setCurrentSessionId(null)
        }
      }
    } catch {}
  }, [currentSessionId, sessions, switchSession])

  /* Rename a session */
  const startRename = useCallback((sessionId: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setRenamingSessionId(sessionId)
    setRenameText(currentTitle || 'New Chat')
  }, [])

  const submitRename = useCallback(async (sessionId: string) => {
    const title = renameText.trim()
    if (!title) { setRenamingSessionId(null); return }
    try {
      await authFetch(`${API_BASE}/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      setSessions(p => p.map(s => s.sessionId === sessionId ? { ...s, title } : s))
    } catch {}
    setRenamingSessionId(null)
  }, [renameText])

  /* Close model menu on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  /* Switch model */
  const switchModel = useCallback(async (modelId: string) => {
    setModelMenuOpen(false)
    try {
      const r = await authFetch(`${API_BASE}/chat/model`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId }),
      })
      if (r.ok) setCurrentModel(modelId)
    } catch {
      // Keep current
    }
  }, [])

  /* Auto-resize textarea */
  useEffect(() => {
    const ta = inputRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px' }
  }, [input])

  /* Cancel ongoing stream request */
  const cancelStream = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  /* Send message — uses SSE streaming (E1) */
  const send = useCallback(async (text?: string) => {
    const msg = (text || input).trim()
    if (!msg || loading) return
    setInput('')
    setError(null)

    // A4 fix: Don't create session upfront — pass existing ID (or empty) to backend.
    // Backend creates a new session if needed and returns it in the done chunk.
    const sessionId = currentSessionId || ''

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: msg,
      timestamp: new Date().toISOString(),
    }
    setMessages(p => [...p, userMsg])

    // Create a streaming placeholder AI message
    const streamMsgId = `ai-${Date.now()}`
    streamingIdRef.current = streamMsgId
    const placeholderMsg: ChatMessage = {
      id: streamMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    }
    setMessages(p => [...p, placeholderMsg])
    setLoading(true)

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await authFetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, sessionId: sessionId || undefined, modelId: currentModel }),
        signal: abort.signal,
      })
      if (!res.ok) {
        if (res.status === 401) throw new Error('Session expired — please refresh the page to log in again.')
        if (res.status === 429) throw new Error('Too many requests — please wait a moment and try again.')
        throw new Error(`Chat failed (${res.status})`)
      }
      if (!res.body) throw new Error('Streaming not supported')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''
        for (const event of events) {
          if (!event.startsWith('data: ')) continue
          try {
            const chunk = JSON.parse(event.slice(6))
            if (chunk.done) {
              // Final chunk — attach sources, suggestions, stats, and update session
              const finalSid = chunk.sessionId || sessionId
              const finalTitle: string | undefined = chunk.sessionTitle
              if (finalSid && finalSid !== currentSessionId) {
                setCurrentSessionId(finalSid)
              }
              setMessages(p => p.map(m => m.id === streamMsgId ? {
                ...m,
                sources: chunk.sources || [],
                suggestions: chunk.suggestions || [],
                stats: chunk.stats,
                model: chunk.model,
                taskAction: chunk.taskAction,
              } : m))
              // A5 fix: update sidebar title with backend-computed title
              if (finalSid) {
                setSessions(p => {
                  const exists = p.some(s => s.sessionId === finalSid)
                  if (!exists) {
                    return [{ sessionId: finalSid, title: finalTitle || msg.slice(0, 50), createdAt: new Date().toISOString(), lastMessageAt: new Date().toISOString(), messageCount: 2 }, ...p]
                  }
                  return p.map(s => s.sessionId === finalSid
                    ? { ...s, title: finalTitle || s.title, messageCount: (s.messageCount || 0) + 2, lastMessageAt: new Date().toISOString() }
                    : s
                  )
                })
              }
            } else if (chunk.delta) {
              setMessages(p => p.map(m => m.id === streamMsgId
                ? { ...m, content: m.content + chunk.delta }
                : m
              ))
            }
          } catch { /* malformed chunk — skip */ }
        }
      }
    } catch (err: unknown) {
      if ((err as any)?.name === 'AbortError') {
        // User cancelled — remove empty placeholder
        setMessages(p => p.filter(m => m.id !== streamMsgId))
      } else {
        const errMsg = err instanceof Error ? err.message : 'Failed to send'
        setError(errMsg)
        setMessages(p => p.filter(m => m.id !== streamMsgId))
        if (!errMsg.includes('expired')) {
          setTimeout(() => setError(prev => prev === errMsg ? null : prev), 5000)
        }
      }
    } finally {
      setLoading(false)
      abortRef.current = null
      streamingIdRef.current = null
      inputRef.current?.focus()
    }
  }, [input, loading, currentSessionId, currentModel])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const clearChat = async () => {
    if (!confirm('Clear all messages in this chat?')) return
    if (currentSessionId) {
      try { await authFetch(`${API_BASE}/chat/history?sessionId=${currentSessionId}`, { method: 'DELETE' }) } catch {}
    }
    setMessages([])
    setError(null)
  }

  const downloadMedia = async (key: string, name?: string) => {
    try {
      // Use direct URL since the media endpoint has no auth requirement
      const directUrl = getDirectMediaUrl(key)
      const r = await fetch(directUrl)
      if (!r.ok) throw new Error('Not available')
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name || `media_${key}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      alert('Media file is no longer in cache. It will be re-cached when the message is received again.')
    }
  }

  /* Regenerate the last AI response — A1 fix: stream directly, don't call send() */
  const regenerate = useCallback(async () => {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
    if (!lastUserMsg || loading) return

    // Remove last AI bubble only
    setMessages(prev => {
      const lastAiIdx = prev.map((m, i) => ({ m, i })).reverse().find(x => x.m.role === 'assistant')?.i
      if (lastAiIdx !== undefined) return prev.slice(0, lastAiIdx)
      return prev
    })

    setError(null)
    const sessionId = currentSessionId || ''
    const streamMsgId = `ai-regen-${Date.now()}`
    streamingIdRef.current = streamMsgId
    setMessages(p => [...p, { id: streamMsgId, role: 'assistant', content: '', timestamp: new Date().toISOString() }])
    setLoading(true)

    const abort = new AbortController()
    abortRef.current = abort

    try {
      const res = await authFetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: lastUserMsg.content, sessionId: sessionId || undefined, modelId: currentModel }),
        signal: abort.signal,
      })
      if (!res.ok || !res.body) throw new Error(`Regenerate failed (${res.status})`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''
        for (const event of events) {
          if (!event.startsWith('data: ')) continue
          try {
            const chunk = JSON.parse(event.slice(6))
            if (chunk.done) {
              setMessages(p => p.map(m => m.id === streamMsgId ? {
                ...m, sources: chunk.sources || [], suggestions: chunk.suggestions || [],
                stats: chunk.stats, model: chunk.model,
              } : m))
            } else if (chunk.delta) {
              setMessages(p => p.map(m => m.id === streamMsgId ? { ...m, content: m.content + chunk.delta } : m))
            }
          } catch {}
        }
      }
    } catch (err: unknown) {
      if ((err as any)?.name !== 'AbortError') {
        setMessages(p => p.filter(m => m.id !== streamMsgId))
      }
    } finally {
      setLoading(false)
      abortRef.current = null
      streamingIdRef.current = null
      inputRef.current?.focus()
    }
  }, [messages, loading, currentSessionId, currentModel])

  const empty = messages.length === 0

  if (!initialized) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" />
      </div>
    )
  }

  return (
    <div className="h-full flex -m-2 sm:-m-6 lg:-m-8">
      {/* ── Mobile sidebar overlay ─────────────────────────────────── */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setMobileSidebarOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute left-0 top-0 bottom-0 w-[260px] bg-[var(--bg-secondary)] border-r border-[var(--border-subtle)] flex flex-col animate-in slide-in-from-left duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--border-subtle)]">
              <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Chats</span>
              <div className="flex items-center gap-1">
                <button onClick={newSession} className="p-1 rounded-md hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-colors" title="New chat"><Plus className="w-3.5 h-3.5" /></button>
                <button onClick={() => setMobileSidebarOpen(false)} className="p-1 rounded-md hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"><X className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {sessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-24 gap-1">
                  <MessagesSquare className="w-5 h-5 text-[var(--text-muted)]" />
                  <span className="text-[10px] text-[var(--text-muted)]">No chats yet</span>
                </div>
              ) : (
                sessions.map(s => (
                  <div
                    key={s.sessionId}
                    onClick={() => { switchSession(s.sessionId); setMobileSidebarOpen(false) }}
                    className={clsx(
                      'group flex items-start justify-between gap-1 px-3 py-2 cursor-pointer rounded-lg mx-1 transition-colors',
                      s.sessionId === currentSessionId ? 'bg-[var(--accent-light)] text-[var(--accent-primary)]' : 'hover:bg-[var(--bg-surface)] text-[var(--text-secondary)]'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={clsx('text-xs font-medium truncate leading-tight', s.sessionId === currentSessionId ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]')}>{s.title || 'New Chat'}</p>
                      <p className="text-[9px] text-[var(--text-muted)] mt-0.5 truncate">
                        {new Date(s.lastMessageAt || s.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        {s.messageCount > 0 && ` · ${s.messageCount} msgs`}
                      </p>
                    </div>
                    <button onClick={(e) => deleteSession(s.sessionId, e)} className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-[var(--text-muted)] hover:text-red-500 transition-all flex-shrink-0"><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Desktop sessions sidebar ───────────────────────────────── */}
      <div className="hidden md:flex flex-col w-[220px] lg:w-[240px] flex-shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
        <div className="flex items-center justify-between px-3 py-3 border-b border-[var(--border-subtle)]">
          <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Chats</span>
          <button
            onClick={newSession}
            className="p-1 rounded-md hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-colors"
            title="New chat"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-24 gap-1">
              <MessagesSquare className="w-5 h-5 text-[var(--text-muted)]" />
              <span className="text-[10px] text-[var(--text-muted)]">No chats yet</span>
            </div>
          ) : (
            sessions.map(s => (
              <div
                key={s.sessionId}
                onClick={() => switchSession(s.sessionId)}
                className={clsx(
                  'group flex items-start justify-between gap-1 px-3 py-2 cursor-pointer rounded-lg mx-1 transition-colors',
                  s.sessionId === currentSessionId
                    ? 'bg-[var(--accent-light)] text-[var(--accent-primary)]'
                    : 'hover:bg-[var(--bg-surface)] text-[var(--text-secondary)]'
                )}
              >
                <div className="flex-1 min-w-0">
                  {renamingSessionId === s.sessionId ? (
                    <input
                      type="text"
                      value={renameText}
                      onChange={e => setRenameText(e.target.value)}
                      onBlur={() => submitRename(s.sessionId)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') submitRename(s.sessionId)
                        if (e.key === 'Escape') setRenamingSessionId(null)
                      }}
                      autoFocus
                      onClick={e => e.stopPropagation()}
                      className="w-full text-xs font-medium bg-[var(--bg-primary)] border border-[var(--accent-primary)] rounded px-1.5 py-0.5 text-[var(--text-primary)] focus:outline-none"
                    />
                  ) : (
                    <p className={clsx(
                      'text-xs font-medium truncate leading-tight',
                      s.sessionId === currentSessionId ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'
                    )}>{s.title || 'New Chat'}</p>
                  )}
                  <p className="text-[9px] text-[var(--text-muted)] mt-0.5 truncate">
                    {new Date(s.lastMessageAt || s.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    {s.messageCount > 0 && ` · ${s.messageCount} msgs`}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0">
                  <button
                    onClick={(e) => startRename(s.sessionId, s.title, e)}
                    className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-colors"
                    title="Rename"
                  >
                    <Edit3 className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => deleteSession(s.sessionId, e)}
                    className="p-0.5 rounded text-[var(--text-muted)] hover:text-red-500 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Main chat column ───────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex-none flex items-center justify-between px-4 sm:px-6 py-3 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMobileSidebarOpen(true)}
            className="md:hidden w-9 h-9 rounded-xl bg-[var(--bg-surface)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition-colors"
            title="Chat sessions"
          >
            <Menu className="w-[18px] h-[18px]" />
          </button>
          <div className="hidden md:flex w-9 h-9 rounded-xl bg-[var(--accent-light)] items-center justify-center">
            <MessageSquare className="w-[18px] h-[18px] text-[var(--accent-primary)]" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-[var(--text-primary)] leading-tight">
              {currentSessionId
                ? (sessions.find(s => s.sessionId === currentSessionId)?.title || 'AI Chat')
                : 'AI Chat'}
            </h1>
            <p className="text-[11px] text-[var(--text-muted)] hidden sm:block">
              Ask anything about your WhatsApp &amp; Gmail messages
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Model selector */}
          {models.length > 0 && (
            <div className="relative" ref={modelMenuRef}>
              <button
                onClick={() => setModelMenuOpen(!modelMenuOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg hover:border-[var(--accent-primary)] transition-colors"
              >
                <Cpu className="w-3 h-3" />
                <span className="hidden sm:inline max-w-[120px] truncate">
                  {models.find(m => m.id === currentModel)?.label || currentModel}
                </span>
                <ChevronDown className={clsx('w-3 h-3 transition-transform', modelMenuOpen && 'rotate-180')} />
              </button>

              {modelMenuOpen && (
                <div className="absolute right-0 mt-1 w-64 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-xl shadow-lg z-50 py-1 overflow-hidden">
                  <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
                    <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Select Model</p>
                  </div>
                  {models.map(m => (
                    <button
                      key={m.id}
                      onClick={() => switchModel(m.id)}
                      className={clsx(
                        'w-full flex items-center justify-between px-3 py-2 text-left text-xs hover:bg-[var(--bg-surface-soft)] transition-colors',
                        m.id === currentModel && 'bg-[var(--accent-light)]'
                      )}
                    >
                      <div>
                        <p className={clsx(
                          'font-medium',
                          m.id === currentModel ? 'text-[var(--accent-primary)]' : 'text-[var(--text-primary)]'
                        )}>{m.label}</p>
                      </div>
                      <span className={clsx(
                        'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide',
                        m.tier === 'premium'
                          ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                          : 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                      )}>
                        {m.tier}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Chat area ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto space-y-5">
          {/* Empty state */}
          {empty && (
            <div className="flex flex-col items-center pt-8 sm:pt-16">
              <div className="w-14 h-14 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center mb-4">
                <Sparkles className="w-7 h-7 text-[var(--accent-primary)]" />
              </div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Ask Mindline anything</h2>
              <p className="text-sm text-[var(--text-muted)] mb-8 text-center max-w-sm">
                Search, summarize, and analyze your messages with AI.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full max-w-2xl">
                {STARTERS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => send(s.query)}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-left hover:border-[var(--accent-primary)] hover:bg-[var(--bg-surface-soft)] transition-all group"
                  >
                    <s.icon className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--accent-primary)] transition-colors flex-shrink-0" />
                    <span className="text-sm font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]">{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <UserBubble key={m.id} message={m} />
            ) : (
              <AiBubble
                key={m.id}
                message={m}
                isLatest={i === messages.length - 1}
                isStreaming={loading && i === messages.length - 1 && !m.stats}
                onSuggestion={send}
                onDownload={downloadMedia}
                onRegenerate={i === messages.length - 1 ? regenerate : undefined}
              />
            )
          )}

          {/* Cancel button while streaming */}
          {loading && (
            <div className="flex justify-center py-1">
              <button
                onClick={cancelStream}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-red-500 bg-[var(--bg-surface)] border border-[var(--border-subtle)] hover:border-red-300 rounded-full transition-all"
                title="Cancel"
              >
                <X className="w-3 h-3" />
                Stop generating
              </button>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}

          <div ref={endRef} />
        </div>
      </div>

      {/* ── Input bar ──────────────────────────────────────────────────── */}
      <div className="flex-none border-t border-[var(--border-subtle)] px-4 sm:px-6 py-3">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Ask anything about your messages\u2026"
              rows={1}
              className="flex-1 px-4 py-2.5 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]/20 transition-all resize-none"
              style={{ minHeight: 42, maxHeight: 120 }}
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim() || input.length > 2000}
              className={clsx(
                'flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all',
                input.trim() && !loading
                  ? 'bg-[var(--accent-primary)] text-white hover:opacity-90'
                  : 'bg-[var(--bg-surface-soft)] text-[var(--text-muted)] cursor-not-allowed'
              )}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[10px] text-[var(--text-muted)]">
              Enter to send · Shift+Enter for new line
            </p>
            {input.length > 100 && (
              <p className={clsx(
                'text-[10px] tabular-nums transition-colors',
                input.length > 1800 ? 'text-red-500' : input.length > 1500 ? 'text-amber-500' : 'text-[var(--text-muted)]'
              )}>
                {input.length}/2000
              </p>
            )}
          </div>
        </div>
      </div>
      </div>   {/* end: flex-1 chat column */}
    </div>
  )
}
