/**
 * Inbox � Unified WhatsApp + Gmail feed
 * Gmail-style layout: sender, subject, AI summary, category badge, time
 * No stats cards. Just the messages.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  RefreshCw,
  Loader2,
  AlertCircle,
  ChevronDown,
  Paperclip,
  MessageSquare,
  Mail,
  Inbox,
  Star,
  Search,
  CheckCheck,
  Clock,
  Zap,
  ImageIcon,
  Video,
  Music,
  FileText,
  Smile,
  Download,
  X,
  Plug,
  Bell,
} from 'lucide-react'
import { API_BASE, authFetch } from '../services/api'
import { formatContact } from '../utils/formatContact'
import { useAuth, readCachedGmailTokens } from '../context/AuthContext'

// -- Types ---------------------------------------------------------------------

interface WAMessage {
  id: string
  content: string
  sender: string
  chat_name?: string
  classification?: string
  decision?: string
  priority?: string
  created_at: string
  message_type?: string
  metadata?: {
    suggestedTask?: string
    messageKey?: string
    mediaType?: 'image' | 'video' | 'audio' | 'sticker' | 'document' | null
    document?: {
      fileName: string
      mimeType: string
      fileSize: number
      pageCount?: number | null
    }
    imageAnalysis?: {
      description: string
      extractedText: string
      hasActionable: boolean
      mimeType: string
    }
  }
}

interface GmailMessage {
  id: string
  gmail_id: string
  from_email: string
  from_name: string
  subject: string
  snippet: string
  body_text: string
  labels: string[]
  gmail_timestamp: string
  is_read: boolean
  has_attachments: boolean
  classification: string | null
  decision: string | null
  priority: string | null
}

interface GmailStatus {
  connected: boolean
  email: string | null
  lastSyncAt: string | null
  totalSynced?: number
  syncEnabled?: boolean
}

// Unified item shown in the inbox list
interface InboxItem {
  id: string
  source: 'whatsapp' | 'gmail'
  from: string
  subject: string
  summary: string
  classification: string | null
  decision: string | null
  priority: string | null
  timestamp: string
  isRead: boolean
  hasAttachments: boolean
  mediaType?: 'image' | 'video' | 'audio' | 'sticker' | 'document' | null
  raw: WAMessage | GmailMessage
}

// -- Helpers -------------------------------------------------------------------

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-red-500',
  high:   'bg-orange-400',
  medium: 'bg-blue-400',
  low:    'bg-gray-300',
}

const CATEGORY_CHIP: Record<string, string> = {
  work:     'bg-blue-50   text-blue-600   border-blue-200   dark:bg-blue-900/20   dark:text-blue-400',
  study:    'bg-purple-50 text-purple-600 border-purple-200 dark:bg-purple-900/20 dark:text-purple-400',
  personal: 'bg-green-50  text-green-600  border-green-200  dark:bg-green-900/20  dark:text-green-400',
  urgent:   'bg-red-50    text-red-600    border-red-200    dark:bg-red-900/20    dark:text-red-400',
  ignore:   'bg-gray-50   text-gray-500   border-gray-200   dark:bg-gray-800      dark:text-gray-500',
}

const MEDIA_TYPE_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  image:    { label: 'Photo',    icon: ImageIcon },
  video:    { label: 'Video',    icon: Video },
  audio:    { label: 'Voice / Audio', icon: Music },
  sticker:  { label: 'Sticker',  icon: Smile },
  document: { label: 'Document', icon: FileText },
}

function formatFileSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function toInboxItem(msg: WAMessage): InboxItem {
  const mediaType = msg.metadata?.mediaType || null
  const isMedia = !!mediaType
  const content = msg.content || ''
  const lines = content.split('\n').filter(Boolean)

  // Detect placeholder content: backend sets e.g. [Media/No Content] or [Image - analysis failed]
  const isPlaceholder = !isMedia && content.startsWith('[') && content.endsWith(']')

  let subject = lines[0]?.slice(0, 80) || '(no content)'
  let summary = lines.slice(1).join(' ').slice(0, 140) || content.slice(0, 140)

  if (isMedia && mediaType !== 'document') {
    subject = MEDIA_TYPE_LABELS[mediaType]?.label ?? 'Media'
    summary = msg.metadata?.imageAnalysis?.description?.slice(0, 140) || ''
  } else if (mediaType === 'document') {
    subject = msg.metadata?.document?.fileName || 'Document'
    summary = `${msg.metadata?.document?.mimeType ?? ''} ${formatFileSize(msg.metadata?.document?.fileSize ?? 0)}`.trim()
  } else if (isPlaceholder) {
    // Sent media or unsupported message type — show a friendlier label
    subject = content.includes('Document') ? '📄 Document' : '📎 Media'
    summary = 'Format not supported for preview'
  }

  return {
    id:             `wa-${msg.id}`,
    source:         'whatsapp',
    from:           formatContact(msg.sender, msg.chat_name) || 'WhatsApp',
    subject,
    summary,
    classification: msg.classification || null,
    decision:       msg.decision || null,
    priority:       msg.priority || null,
    timestamp:      msg.created_at,
    isRead:         true,
    hasAttachments: mediaType === 'document',
    mediaType,
    raw:            msg,
  }
}

function toInboxItemFromGmail(msg: GmailMessage): InboxItem {
  return {
    id:             `gm-${msg.id}`,
    source:         'gmail',
    from:           msg.from_name || msg.from_email || 'Gmail',
    subject:        msg.subject || '(no subject)',
    summary:        msg.snippet || '',
    classification: msg.classification,
    decision:       msg.decision,
    priority:       msg.priority,
    timestamp:      msg.gmail_timestamp,
    isRead:         msg.is_read,
    hasAttachments: msg.has_attachments,
    raw:            msg,
  }
}

function relativeTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const now      = new Date()
  const diffMs   = Date.now() - d.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  const timeStr  = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffMins < 2)                         return 'just now'
  if (d.toDateString() === now.toDateString()) return timeStr             // today → "10:30 AM"
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `Yest\ ${timeStr}` // "Yest 10:30 AM"
  if (diffMs < 7 * 86_400_000) {                                           // this week
    const dow = d.toLocaleDateString([], { weekday: 'short' })
    return `${dow} ${timeStr}`
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + timeStr
}

// -- Expanded: WhatsApp --------------------------------------------------------

function ExpandedWA({ msg }: { msg: WAMessage }) {
  const [downloading, setDownloading]   = useState(false)
  const [dlError, setDlError]           = useState<string | null>(null)
  const [imgUrl, setImgUrl]             = useState<string | null>(null)
  const [imgLoading, setImgLoading]     = useState(false)
  const [imgFailed, setImgFailed]       = useState(false)

  const messageKey = msg.metadata?.messageKey
  const mediaType  = msg.metadata?.mediaType
  const hasMedia   = !!mediaType && !!messageKey

  // Auto-load image from media cache for inline preview
  useEffect(() => {
    if (mediaType !== 'image' || !messageKey) return
    let objectUrl: string | null = null
    setImgLoading(true)
    setImgFailed(false)
    setImgUrl(null)
    authFetch(`${API_BASE}/whatsapp/media/${encodeURIComponent(messageKey)}`)
      .then(res => { if (!res.ok) throw new Error('not_in_cache'); return res.blob() })
      .then(blob => { objectUrl = URL.createObjectURL(blob); setImgUrl(objectUrl) })
      .catch(() => setImgFailed(true))
      .finally(() => setImgLoading(false))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [mediaType, messageKey])

  const handleDownload = async () => {
    if (!messageKey) return
    setDownloading(true)
    setDlError(null)
    try {
      const res = await authFetch(`${API_BASE}/whatsapp/media/${encodeURIComponent(messageKey)}`)
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || `Server returned ${res.status}`)
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const doc  = msg.metadata?.document
      const mediaTypeLabel = mediaType ?? 'media'
      const ext  = blob.type.split('/')[1]?.split(';')[0] || 'bin'
      a.href     = url
      a.download = doc?.fileName || `${mediaTypeLabel}_${messageKey}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setDlError(err.message || 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="px-4 pb-4 pt-3 border-t border-[var(--border-subtle)] space-y-3">
      <div className="flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
        <span>From: {formatContact(msg.sender, msg.chat_name)}</span>
        <span>&middot;</span>
        <span>{new Date(msg.created_at).toLocaleString()}</span>
      </div>
      {/* Media / document card  — shown for all non-text messages */}
      {hasMedia ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-soft)] overflow-hidden">

          {/* ── Image preview section ── */}
          {mediaType === 'image' && (
            <>
              {/* Loading state */}
              {imgLoading && (
                <div className="flex items-center justify-center h-40 bg-[var(--bg-surface)]">
                  <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
                </div>
              )}

              {/* Image loaded — show it */}
              {imgUrl && !imgLoading && (
                <div className="relative bg-black/5 dark:bg-black/20">
                  <img
                    src={imgUrl}
                    alt={msg.metadata?.imageAnalysis?.description || 'WhatsApp image'}
                    className="w-full max-h-72 object-contain rounded-t-xl"
                  />
                </div>
              )}

              {/* Not in cache — friendly message */}
              {imgFailed && !imgLoading && (
                <div className="flex items-center gap-2 px-3 py-3 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-900 text-xs text-amber-700 dark:text-amber-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>Image not in cache — received before this server session or server was restarted</span>
                </div>
              )}
            </>
          )}

          {/* ── Info row: icon + metadata + download ── */}
          <div className="flex items-center gap-3 p-3">
            {/* Icon */}
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
              mediaType === 'image'    ? 'bg-blue-50 dark:bg-blue-900/30' :
              mediaType === 'video'    ? 'bg-purple-50 dark:bg-purple-900/30' :
              mediaType === 'audio'    ? 'bg-green-50 dark:bg-green-900/30' :
              mediaType === 'sticker'  ? 'bg-yellow-50 dark:bg-yellow-900/30' :
                                        'bg-slate-100 dark:bg-slate-800'
            }`}>
              {mediaType === 'document' ? <FileText className="w-5 h-5 text-slate-500" /> :
               mediaType === 'image'    ? <ImageIcon className="w-5 h-5 text-blue-500" /> :
               mediaType === 'video'    ? <Video className="w-5 h-5 text-purple-500" /> :
               mediaType === 'audio'    ? <Music className="w-5 h-5 text-green-500" /> :
                                         <Smile className="w-5 h-5 text-yellow-500" />}
            </div>

            {/* Metadata */}
            <div className="flex-1 min-w-0">
              {msg.metadata?.document ? (
                <>
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {msg.metadata.document.fileName}
                  </p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5 space-x-1">
                    <span>{msg.metadata.document.mimeType}</span>
                    {msg.metadata.document.fileSize > 0 && (
                      <span>&middot; {formatFileSize(msg.metadata.document.fileSize)}</span>
                    )}
                    {msg.metadata.document.pageCount != null && (
                      <span>&middot; {msg.metadata.document.pageCount} page{msg.metadata.document.pageCount !== 1 ? 's' : ''}</span>
                    )}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-[var(--text-primary)] capitalize">
                    {MEDIA_TYPE_LABELS[mediaType!]?.label ?? mediaType}
                  </p>
                  {msg.metadata?.imageAnalysis?.description && (
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5 line-clamp-2">
                      {msg.metadata.imageAnalysis.description}
                    </p>
                  )}
                  {msg.content && !msg.content.startsWith('[') && (
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5 line-clamp-1 italic">{msg.content}</p>
                  )}
                </>
              )}
            </div>

            {/* Download button */}
            <button
              onClick={handleDownload}
              disabled={downloading}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all shrink-0 ${
                downloading
                  ? 'border-[var(--border-subtle)] text-[var(--text-muted)] cursor-wait'
                  : 'border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/5 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/15 active:scale-95'
              }`}
            >
              {downloading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Download className="w-3.5 h-3.5" />
              }
              {downloading ? 'Saving…' : 'Download'}
            </button>
          </div>

          {/* Download error row (non-image types) */}
          {dlError && mediaType !== 'image' && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-100 dark:border-amber-900 text-xs text-amber-700 dark:text-amber-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{dlError}</span>
              <span className="ml-auto text-[10px]">
                {!messageKey ? 'No message key' : 'File not in cache — received before server restart?'}
              </span>
            </div>
          )}

          {/* Download error row (image — download specifically failed after preview loaded fine) */}
          {dlError && mediaType === 'image' && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border-t border-red-100 dark:border-red-900 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>Download failed: {dlError}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="p-3 bg-[var(--bg-surface-soft)] rounded-lg">
          {msg.content && msg.content.startsWith('[') && msg.content.endsWith(']') ? (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] italic">
              <Paperclip className="w-4 h-4 shrink-0" />
              <span>
                {msg.content === '[Media/No Content]'
                  ? 'Media message — format not supported for preview (video, audio, or sticker)'
                  : msg.content === '[Image - analysis failed]'
                  ? 'Image received but could not be analyzed (Gemini Vision error)'
                  : msg.content.replace(/^\[|\]$/g, '')}
              </span>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
              {msg.content}
            </p>
          )}
        </div>
      )}

      {/* AI Vision Analysis section — shown whenever Gemini analyzed this image */}
      {msg.metadata?.imageAnalysis && (msg.metadata.imageAnalysis.description || msg.metadata.imageAnalysis.extractedText) && (
        <div className="rounded-lg border border-blue-100 dark:border-blue-900 overflow-hidden">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 border-b border-blue-100 dark:border-blue-900">
            <Zap className="w-3 h-3 text-blue-500" />
            <p className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">Gemini Vision Analysis</p>
          </div>
          <div className="p-3 bg-blue-50/40 dark:bg-blue-900/10 space-y-2">
            {msg.metadata.imageAnalysis.description && (
              <div>
                <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-0.5">Description</p>
                <p className="text-xs text-[var(--text-primary)] leading-relaxed">
                  {msg.metadata.imageAnalysis.description}
                </p>
              </div>
            )}
            {msg.metadata.imageAnalysis.extractedText && (
              <div>
                <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-0.5">Text found in image</p>
                <p className="text-xs text-[var(--text-primary)] font-mono leading-relaxed whitespace-pre-wrap break-words bg-white dark:bg-black/20 rounded px-2 py-1.5 border border-blue-100 dark:border-blue-900">
                  {msg.metadata.imageAnalysis.extractedText}
                </p>
              </div>
            )}
            {msg.metadata.imageAnalysis.hasActionable && (
              <div className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCheck className="w-3 h-3" />
                Contains actionable content
              </div>
            )}
          </div>
        </div>
      )}

      {msg.metadata?.suggestedTask && (
        <div className="flex items-start gap-2 p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
          <Zap className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            <span className="font-medium">Suggested task:</span> {msg.metadata.suggestedTask}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {msg.classification && msg.classification !== 'ignore' && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${CATEGORY_CHIP[msg.classification] ?? CATEGORY_CHIP.personal}`}>
            {msg.classification}
          </span>
        )}
        {msg.decision === 'create' && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">
            actionable
          </span>
        )}
        {msg.priority && msg.priority !== 'low' && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-surface-soft)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
            {msg.priority}
          </span>
        )}
      </div>
    </div>
  )
}

// -- Expanded: Gmail -----------------------------------------------------------

function ExpandedGmail({ msg }: { msg: GmailMessage }) {
  const body = msg.body_text?.trim() || msg.snippet || 'No content available.'
  return (
    <div className="px-4 pb-4 pt-3 border-t border-[var(--border-subtle)] space-y-3">
      <div className="flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
        <span>From: {msg.from_name} &lt;{msg.from_email}&gt;</span>
        <span>&middot;</span>
        <span>{new Date(msg.gmail_timestamp).toLocaleString()}</span>
      </div>

      {/* AI Summary */}
      {msg.snippet && (
        <div className="flex items-start gap-2 p-3 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-100 dark:border-indigo-800">
          <Zap className="w-3.5 h-3.5 text-indigo-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-[10px] font-medium text-indigo-500 uppercase tracking-wide mb-0.5">AI Summary</p>
            <p className="text-xs text-indigo-700 dark:text-indigo-300 leading-relaxed">{msg.snippet}</p>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="p-3 bg-[var(--bg-surface-soft)] rounded-lg max-h-64 overflow-y-auto">
        <p className="text-xs text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed font-mono">
          {body.slice(0, 2000)}{body.length > 2000 ? '\n\n[truncated�]' : ''}
        </p>
      </div>

      {/* Chips */}
      <div className="flex flex-wrap gap-1.5">
        {msg.classification && msg.classification !== 'ignore' && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${CATEGORY_CHIP[msg.classification] ?? CATEGORY_CHIP.personal}`}>
            {msg.classification}
          </span>
        )}
        {msg.decision === 'create' && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">
            actionable
          </span>
        )}
        {msg.priority && msg.priority !== 'low' && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-surface-soft)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
            {msg.priority}
          </span>
        )}
        {msg.labels?.filter(l => !['UNREAD', 'INBOX'].includes(l)).map((label, i) => (
          <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-surface-soft)] text-[var(--text-muted)] border border-[var(--border-subtle)]">
            {label.toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  )
}

// -- Main ----------------------------------------------------------------------

type FilterKey = 'all' | 'whatsapp' | 'gmail' | 'actionable' | 'unread'

const FILTERS: { key: FilterKey; label: string; icon: React.ElementType }[] = [
  { key: 'all',        label: 'All',        icon: Inbox },
  { key: 'unread',     label: 'Unread',     icon: Clock },
  { key: 'actionable', label: 'Actionable', icon: Star },
  { key: 'whatsapp',   label: 'WhatsApp',   icon: MessageSquare },
  { key: 'gmail',      label: 'Gmail',      icon: Mail },
]

export default function Dashboard() {
  const { user, session, loginWithGoogle } = useAuth()

  const [waMessages,    setWaMessages]    = useState<WAMessage[]>([])
  const [gmailMessages, setGmailMessages] = useState<GmailMessage[]>([])
  const [gmailStatus,   setGmailStatus]   = useState<GmailStatus | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [syncing,       setSyncing]       = useState(false)
  const [connecting,    setConnecting]    = useState(false)
  const [autoConnecting, setAutoConnecting] = useState(false)
  const [isPolling,     setIsPolling]     = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [gmailSyncError, setGmailSyncError] = useState<string | null>(null)
  const [syncResult,    setSyncResult]    = useState<{ synced: number; classified: number } | null>(null)
  const [lastPoll,      setLastPoll]      = useState<Date | null>(null)
  const [filter,        setFilter]        = useState<FilterKey>('all')
  const [search,        setSearch]        = useState('')
  const [expandedId,    setExpandedId]    = useState<string | null>(null)
  const [readIds,       setReadIds]       = useState<Set<string>>(new Set())
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchWA = useCallback(async () => {
    try {
      const res  = await authFetch(`${API_BASE}/messages?limit=100`)
      const json = await res.json()
      if (json.success) setWaMessages(json.data || [])
    } catch { /* silent */ }
  }, [])

  const fetchGmail = useCallback(async () => {
    try {
      const statusRes  = await authFetch(`${API_BASE}/gmail/status`)
      const statusJson = await statusRes.json()
      if (!statusJson.success || !statusJson.data?.connected) return
      setGmailStatus(statusJson.data)
      const msgRes  = await authFetch(`${API_BASE}/gmail/messages?limit=100`)
      const msgJson = await msgRes.json()
      if (msgJson.success) setGmailMessages(msgJson.data || [])
    } catch { /* Gmail not connected */ }
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await Promise.all([fetchWA(), fetchGmail()])
    } catch (err: any) {
      setError(err.message || 'Failed to load inbox')
    } finally {
      setLoading(false)
    }
  }, [fetchWA, fetchGmail])

  useEffect(() => { loadAll() }, [loadAll])

  const handleGmailSync = async () => {
    setSyncing(true)
    setGmailSyncError(null)
    try {
      const res = await authFetch(`${API_BASE}/gmail/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxMessages: 50 }),
      })
      const json = await res.json()
      if (json.success) {
        setSyncResult(json.data)
        setLastPoll(new Date())
        await fetchGmail()
        setTimeout(() => setSyncResult(null), 8000)
      } else if (json.reconnect || res.status === 401) {
        // Try silent token refresh from cache
        if (user && session?.access_token) {
          const cached = readCachedGmailTokens(user.id)
          if (cached) {
            const saveRes = await authFetch(`${API_BASE}/gmail/save-tokens`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                accessToken: cached.accessToken,
                refreshToken: cached.refreshToken,
                googleEmail: cached.googleEmail,
                expiresIn: 3600,
              }),
            })
            if (saveRes.ok) {
              const retryRes = await authFetch(`${API_BASE}/gmail/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ maxMessages: 50 }),
              })
              const retryJson = await retryRes.json()
              if (retryJson.success) {
                setSyncResult(retryJson.data)
                setLastPoll(new Date())
                await fetchGmail()
                setTimeout(() => setSyncResult(null), 8000)
                setSyncing(false)
                return
              }
            }
          }
        }
        setGmailSyncError('Gmail token expired. Please reconnect.')
        setGmailStatus(prev => prev ? { ...prev, connected: false } : null)
      } else {
        setGmailSyncError(json.message || 'Sync failed.')
      }
    } catch { /* silent */ } finally {
      setSyncing(false)
    }
  }

  const handleGmailConnect = async () => {
    setConnecting(true)
    setGmailSyncError(null)
    try {
      if (user && session?.access_token) {
        const cached = readCachedGmailTokens(user.id)
        if (cached) {
          const res = await authFetch(`${API_BASE}/gmail/save-tokens`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              accessToken: cached.accessToken,
              refreshToken: cached.refreshToken,
              googleEmail: cached.googleEmail,
              expiresIn: 3600,
            }),
          })
          if (res.ok) {
            await fetchGmail()
            setTimeout(() => fetchGmail(), 3000)
            setConnecting(false)
            return
          }
        }
      }
      await loginWithGoogle()
    } catch (err: any) {
      setGmailSyncError(err.message || 'Failed to connect Gmail')
    }
    setTimeout(() => setConnecting(false), 5000)
  }

  const pollForNewEmails = useCallback(async () => {
    if (!gmailStatus?.connected) return
    setIsPolling(true)
    try {
      const res  = await authFetch(`${API_BASE}/gmail/check-new`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = await res.json()
      if (json.success && json.data?.synced > 0) {
        await fetchGmail()
        setSyncResult(json.data)
        setLastPoll(new Date())
        setTimeout(() => setSyncResult(null), 6000)
      }
      setLastPoll(new Date())
    } catch { /* silent */ } finally {
      setIsPolling(false)
    }
  }, [gmailStatus?.connected, fetchGmail])

  // Auto-poll every 60 s when Gmail is connected
  useEffect(() => {
    if (gmailStatus?.connected) {
      pollTimerRef.current = setInterval(pollForNewEmails, 60_000)
      return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current) }
    } else {
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null }
    }
  }, [gmailStatus?.connected, pollForNewEmails])

  // Auto-connect using cached Google tokens if Gmail is disconnected
  useEffect(() => {
    if (loading) return
    if (gmailStatus?.connected) return
    if (!user || !session?.access_token) return
    const cached = readCachedGmailTokens(user.id)
    if (!cached) return
    let cancelled = false
    setAutoConnecting(true)
    authFetch(`${API_BASE}/gmail/save-tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: cached.accessToken,
        refreshToken: cached.refreshToken,
        googleEmail: cached.googleEmail,
        expiresIn: 3600,
      }),
    }).then(res => {
      if (!cancelled && res.ok) {
        fetchGmail()
        setTimeout(() => { if (!cancelled) fetchGmail() }, 3000)
      }
    }).catch(() => {}).finally(() => { if (!cancelled) setAutoConnecting(false) })
    return () => { cancelled = true }
  }, [loading, gmailStatus?.connected, user, session, fetchGmail])

  // -- Merge & filter ----------------------------------------------------------
  const allItems: InboxItem[] = [
    ...waMessages.map(toInboxItem),
    ...gmailMessages.map(toInboxItemFromGmail),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  const displayed = allItems.filter(item => {
    if (filter === 'whatsapp'   && item.source !== 'whatsapp') return false
    if (filter === 'gmail'      && item.source !== 'gmail')    return false
    if (filter === 'actionable' && item.decision !== 'create') return false
    if (filter === 'unread'     && item.isRead)                return false
    if (search) {
      const q = search.toLowerCase()
      return (
        item.from.toLowerCase().includes(q)    ||
        item.subject.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q)
      )
    }
    return true
  })

  const unreadCount = allItems.filter(i => !i.isRead).length

  // -- Render ------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-5 h-5 text-[var(--text-muted)] animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4 animate-fade-in pb-10 max-w-full">

      {/* â”€â”€ Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold text-[var(--text-primary)] tracking-tight">Inbox</h1>
            {unreadCount > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-500 text-white leading-none">
                {unreadCount}
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {allItems.length} message{allItems.length !== 1 ? 's' : ''}
            {allItems.filter(i => i.source === 'whatsapp').length > 0 && (
              <span className="text-green-600 dark:text-green-400 font-medium"> &middot; {allItems.filter(i => i.source === 'whatsapp').length} WhatsApp</span>
            )}
            {allItems.filter(i => i.source === 'gmail').length > 0 && (
              <span className="text-red-500 font-medium"> &middot; {allItems.filter(i => i.source === 'gmail').length} Gmail</span>
            )}
          </p>
        </div>
        <button
          onClick={loadAll}
          title="Refresh all"
          className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-soft)] transition-colors shrink-0 mt-0.5"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* â”€â”€ Gmail connection bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {!loading && autoConnecting && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800">
          <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
          <p className="text-sm text-blue-700 dark:text-blue-300">Connecting Gmail automatically&hellip;</p>
        </div>
      )}

      {!loading && !autoConnecting && !gmailStatus?.connected && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface-soft)]">
          <div className="w-9 h-9 rounded-full bg-red-50 dark:bg-red-900/30 flex items-center justify-center shrink-0">
            <Mail className="w-4 h-4 text-red-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">Connect Gmail</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">See your emails alongside WhatsApp messages</p>
          </div>
          <button
            onClick={handleGmailConnect}
            disabled={connecting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--accent-primary)] text-white hover:opacity-90 disabled:opacity-60 transition-opacity shrink-0"
          >
            {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
            {connecting ? 'Connecting&hellip;' : 'Connect'}
          </button>
        </div>
      )}

      {!loading && gmailStatus?.connected && (
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-[var(--bg-surface-soft)] border border-[var(--border-subtle)]">
          <span className="relative flex shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 block" />
            {isPolling && <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />}
          </span>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-medium text-[var(--text-primary)] truncate block">{gmailStatus.email}</span>
            {lastPoll ? (
              <span className="text-[11px] text-[var(--text-muted)]">Synced {relativeTime(lastPoll.toISOString())}</span>
            ) : gmailStatus.lastSyncAt ? (
              <span className="text-[11px] text-[var(--text-muted)]">Last synced {relativeTime(gmailStatus.lastSyncAt)}</span>
            ) : (
              <span className="text-[11px] text-[var(--text-muted)]">Connected</span>
            )}
          </div>
          <button
            onClick={handleGmailSync}
            disabled={syncing || isPolling}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] border border-[var(--border-subtle)] disabled:opacity-50 transition-all"
          >
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {syncing ? 'Syncing&hellip;' : 'Sync'}
          </button>
        </div>
      )}

      {/* â”€â”€ Sync result toast â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {syncResult && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-700 dark:text-emerald-300">
          <Bell className="w-4 h-4 shrink-0" />
          <span className="flex-1">
            <span className="font-semibold">{syncResult.synced} new email{syncResult.synced !== 1 ? 's' : ''}</span> synced
            {syncResult.classified > 0 && `, ${syncResult.classified} classified by AI`}
          </span>
          <button onClick={() => setSyncResult(null)} className="shrink-0 text-emerald-500 hover:text-emerald-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* â”€â”€ Gmail error â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {gmailSyncError && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{gmailSyncError}</span>
          <button onClick={() => setGmailSyncError(null)} className="shrink-0 text-amber-500 hover:text-amber-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* â”€â”€ General error â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {error && (
        <div className="flex items-center gap-2.5 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-xl text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* â”€â”€ Search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
        <input
          type="text"
          placeholder="Search messages&hellip;"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-9 py-2 text-sm bg-[var(--bg-surface-soft)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/30 transition"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* â”€â”€ Filter tabs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
              filter === f.key
                ? 'bg-[var(--accent-primary)] text-white shadow-sm'
                : 'bg-[var(--bg-surface-soft)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-transparent hover:border-[var(--border-subtle)]'
            }`}
          >
            <f.icon className="w-3.5 h-3.5" />
            {f.label}
            {f.key === 'unread' && unreadCount > 0 && (
              <span className={`text-[10px] px-1.5 py-px rounded-full font-bold leading-none ${
                filter === 'unread' ? 'bg-white/30 text-white' : 'bg-blue-500 text-white'
              }`}>
                {unreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Message list */}
      {displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[var(--bg-surface-soft)] flex items-center justify-center mb-4 shadow-inner">
            <Inbox className="w-8 h-8 text-[var(--text-muted)]" />
          </div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {search ? `No results for "${search}"` : filter === 'all' ? 'Your inbox is empty' : `No ${filter} messages`}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-1.5 max-w-xs leading-relaxed">
            {search
              ? 'Try a different search term.'
              : filter === 'all'
              ? 'WhatsApp and Gmail messages will appear here.'
              : filter === 'unread'
              ? 'All caught up! No unread messages.'
              : `No ${filter} messages yet.`
            }
          </p>
          {search && (
            <button
              onClick={() => setSearch('')}
              className="mt-3 text-xs text-[var(--accent-primary)] hover:underline"
            >
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden bg-[var(--bg-surface)] shadow-sm">
          {displayed.map((item, idx) => {
            const isUnread = !item.isRead && !readIds.has(item.id)
            const MediaIcon = item.mediaType ? MEDIA_TYPE_LABELS[item.mediaType]?.icon : null
            const isDocument = item.mediaType === 'document'
            const isMultimedia = !!item.mediaType && !isDocument
            const isExpanded = expandedId === item.id
            return (
              <div
                key={item.id}
                className={`${idx > 0 ? 'border-t border-[var(--border-subtle)]' : ''} transition-colors duration-200 ${
                  isUnread
                    ? 'bg-blue-50/70 dark:bg-blue-900/10'
                    : isExpanded
                    ? 'bg-[var(--bg-surface-soft)]'
                    : 'bg-[var(--bg-surface)]'
                }`}
              >
                {/* Row button */}
                <button
                  onClick={() => {
                    setExpandedId(isExpanded ? null : item.id)
                    if (isUnread) setReadIds(prev => new Set([...prev, item.id]))
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--bg-surface-soft)] transition-colors group"
                >
                  {/* Left col: unread-bar + priority dot stacked */}
                  <div className="flex flex-col items-center gap-1.5 shrink-0 w-2">
                    {isUnread
                      ? <span className="w-2 h-2 rounded-full bg-blue-500" />
                      : <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[item.priority ?? 'low'] ?? PRIORITY_DOT.low}`} />
                    }
                  </div>

                  {/* Source avatar */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-[13px] font-semibold ${
                    item.source === 'gmail'
                      ? 'bg-red-50 text-red-500 dark:bg-red-900/30 ring-1 ring-red-100 dark:ring-red-900'
                      : 'bg-green-50 text-green-600 dark:bg-green-900/30 ring-1 ring-green-100 dark:ring-green-900'
                  }`}>
                    {item.source === 'gmail'
                      ? <Mail className="w-3.5 h-3.5" />
                      : <MessageSquare className="w-3.5 h-3.5" />
                    }
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Row 1: sender + attachments indicator */}
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`text-sm truncate max-w-[180px] sm:max-w-xs ${isUnread ? 'font-bold text-[var(--text-primary)]' : 'font-medium text-[var(--text-secondary)]'}`}>
                        {item.from}
                      </span>
                      {(item.hasAttachments || isDocument) && (
                        <Paperclip className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
                      )}
                    </div>
                    {/* Row 2: subject / media badge / summary */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      {isMultimedia && MediaIcon && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-white dark:bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-subtle)] shrink-0 shadow-sm">
                          <MediaIcon className="w-2.5 h-2.5" />
                          {MEDIA_TYPE_LABELS[item.mediaType!].label}
                        </span>
                      )}
                      {isDocument && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 shrink-0">
                          <FileText className="w-2.5 h-2.5" />
                          {item.subject}
                        </span>
                      )}
                      {!isDocument && !isMultimedia && (
                        <span className={`text-xs truncate ${isUnread ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                          {item.subject}
                        </span>
                      )}
                      {(isMultimedia || (!isDocument && item.summary)) && (
                        <span className="text-xs text-[var(--text-muted)] truncate hidden sm:inline">
                          {isMultimedia ? <em>{item.summary}</em> : <>&nbsp;&mdash; {item.summary}</>}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right col */}
                  <div className="flex flex-col items-end gap-1 shrink-0 ml-1">
                    <span className={`text-[11px] font-mono ${isUnread ? 'text-blue-500 font-semibold' : 'text-[var(--text-muted)]'}`}>
                      {relativeTime(item.timestamp)}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {item.classification && item.classification !== 'ignore' && (
                        <span className={`hidden md:inline text-[10px] px-1.5 py-0.5 rounded border ${CATEGORY_CHIP[item.classification] ?? CATEGORY_CHIP.personal}`}>
                          {item.classification}
                        </span>
                      )}
                      <ChevronDown className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                </button>

                {/* Expanded panel */}
                {isExpanded && (
                  item.source === 'gmail'
                    ? <ExpandedGmail msg={item.raw as GmailMessage} />
                    : <ExpandedWA    msg={item.raw as WAMessage} />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Footer */}
      {displayed.length > 0 && (
        <div className="flex items-center justify-center gap-1.5 pt-2 pb-2 text-xs text-[var(--text-muted)]">
          <CheckCheck className="w-3.5 h-3.5" />
          <span>
            {displayed.length === allItems.length
              ? `${allItems.length} message${allItems.length !== 1 ? 's' : ''}`
              : `${displayed.length} of ${allItems.length} messages`
            }
          </span>
        </div>
      )}
    </div>
  )
}
