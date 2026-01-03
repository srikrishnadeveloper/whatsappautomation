/**
 * Connect Page - Redesigned for Desktop & Mobile
 * Desktop: Two-column layout (connection left, activity right)
 * Mobile: Single column (unchanged)
 * - No popup on revisit when already connected
 * - Clear data option
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { 
  CheckCircle2, 
  AlertCircle,
  WifiOff,
  Loader2,
  Wifi,
  RefreshCw,
  Trash2,
  Smartphone,
  Sparkles,
  LogOut,
  Inbox,
  CheckSquare,
  Search,
  MessageSquare,
  ArrowRight
} from 'lucide-react'
import { API_BASE } from '../services/api'

const WAITING_TIPS = [
  "Messages are classified using AI to identify tasks automatically",
  "Your data stays private - we only analyze message content locally",
  "Keep WhatsApp open on your phone for the best experience"
]

interface WhatsAppState {
  status: 'disconnected' | 'initializing' | 'qr_ready' | 'connecting' | 'authenticating' | 'loading_chats' | 'connected' | 'error'
  qrCode: string | null
  user: { name: string; phone: string } | null
  lastUpdate: string
  error: string | null
  messagesProcessed: number
  progress: number
  progressText: string
  connectionStartTime: number | null
}

interface LogEntry {
  id: string
  timestamp: string
  type: 'info' | 'success' | 'warning' | 'error' | 'message'
  icon: string
  title: string
  details?: string
}

export default function Connect() {
  const [state, setState] = useState<WhatsAppState>({
    status: 'disconnected',
    qrCode: null,
    user: null,
    lastUpdate: new Date().toISOString(),
    error: null,
    messagesProcessed: 0,
    progress: 0,
    progressText: '',
    connectionStartTime: null
  })
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [clearingData, setClearingData] = useState(false)
  const [elapsedTime, setElapsedTime] = useState(0)
  const [currentTip, setCurrentTip] = useState(0)
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null)
  const sseRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasInitialized = useRef(false)

  const fetchStatus = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/whatsapp/status`)
      const json = await res.json()
      if (json.success) {
        setState(prev => ({
          ...json.data,
          // Preserve messagesProcessed if the new value is 0 (prevents flicker)
          messagesProcessed: json.data.messagesProcessed || prev.messagesProcessed
        }))
      }
    } catch (err) {
      console.error('Failed to fetch status:', err)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  // Handle QR code image loading
  useEffect(() => {
    if (state.status === 'qr_ready') {
      if (state.qrCode && state.qrCode.startsWith('data:')) {
        setQrImageUrl(state.qrCode)
      } else if (state.qrCode && state.qrCode.startsWith('http')) {
        setQrImageUrl(state.qrCode)
      } else {
        const loadQr = async () => {
          try {
            const res = await fetch(`${API_BASE}/whatsapp/qr-image`)
            if (res.ok) {
              const blob = await res.blob()
              const url = URL.createObjectURL(blob)
              setQrImageUrl(prev => {
                if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
                return url
              })
            }
          } catch (err) {}
        }
        loadQr()
        const interval = setInterval(loadQr, 55000)
        return () => clearInterval(interval)
      }
    } else {
      setQrImageUrl(prev => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
        return null
      })
    }
  }, [state.status, state.qrCode])

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/logs`)
      const json = await res.json()
      if (json.success) setLogs(json.data)
    } catch (err) {}
  }, [])

  const clearLogs = async () => {
    try {
      await fetch(`${API_BASE}/logs`, { method: 'DELETE' })
      setLogs([])
    } catch (err) {}
  }

  const handleConnect = async () => {
    setActionLoading(true)
    try {
      await fetch(`${API_BASE}/whatsapp/start`, { method: 'POST' })
      await fetchStatus()
    } catch (err) {} finally {
      setActionLoading(false)
    }
  }

  const handleDisconnect = async () => {
    setActionLoading(true)
    try {
      await fetch(`${API_BASE}/whatsapp/stop`, { method: 'POST' })
      await fetchStatus()
    } catch (err) {} finally {
      setActionLoading(false)
    }
  }

  const handleLogout = async () => {
    if (!confirm('This will log out and clear your WhatsApp session. Continue?')) return
    setActionLoading(true)
    try {
      await fetch(`${API_BASE}/whatsapp/logout`, { method: 'POST' })
      await fetchStatus()
    } catch (err) {} finally {
      setActionLoading(false)
    }
  }

  const handleClearData = async () => {
    if (!confirm('Clear all messages and tasks? This cannot be undone.')) return
    setClearingData(true)
    try {
      await Promise.all([
        fetch(`${API_BASE}/logs`, { method: 'DELETE' }),
        fetch(`${API_BASE}/messages/clear`, { method: 'DELETE' }),
        fetch(`${API_BASE}/actions/clear`, { method: 'DELETE' })
      ])
      setLogs([])
      alert('All data cleared successfully!')
    } catch (err) {
      console.error('Failed to clear data:', err)
    } finally {
      setClearingData(false)
    }
  }

  const handleCancel = async () => {
    setActionLoading(true)
    try {
      await fetch(`${API_BASE}/whatsapp/stop`, { method: 'POST' })
      await fetchStatus()
    } catch (err) {} finally {
      setActionLoading(false)
    }
  }

  // Elapsed time timer
  useEffect(() => {
    if (state.connectionStartTime && state.status !== 'connected' && state.status !== 'disconnected' && state.status !== 'error') {
      const interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - state.connectionStartTime!) / 1000))
      }, 1000)
      return () => clearInterval(interval)
    } else {
      setElapsedTime(0)
    }
  }, [state.connectionStartTime, state.status])

  // Rotate tips
  useEffect(() => {
    if (state.status === 'initializing' || state.status === 'qr_ready' || state.status === 'loading_chats') {
      const interval = setInterval(() => {
        setCurrentTip(prev => (prev + 1) % WAITING_TIPS.length)
      }, 5000)
      return () => clearInterval(interval)
    }
  }, [state.status])

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  }

  // Initial load - only once
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true
      fetchStatus()
      fetchLogs()
    }
  }, [fetchStatus, fetchLogs])

  // SSE with auto-reconnect
  const connectSSE = useCallback(() => {
    if (sseRef.current) sseRef.current.close()

    const eventSource = new EventSource(`${API_BASE}/whatsapp/events`)
    sseRef.current = eventSource

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        setState(prev => ({
          ...data,
          messagesProcessed: data.messagesProcessed || prev.messagesProcessed
        }))
      } catch (err) {}
    }

    eventSource.onerror = () => {
      eventSource.close()
      sseRef.current = null
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = setTimeout(() => connectSSE(), 2000)
    }
  }, [])

  useEffect(() => {
    connectSSE()
    return () => {
      if (sseRef.current) sseRef.current.close()
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
    }
  }, [connectSSE])

  // Polling - less aggressive when connected
  useEffect(() => {
    const activeStates = ['initializing', 'qr_ready', 'connecting', 'authenticating', 'loading_chats']
    const pollInterval = activeStates.includes(state.status) ? 2000 : 30000
    
    const interval = setInterval(() => {
      fetchStatus(false) // Don't show loading spinner on poll
      fetchLogs()
    }, pollInterval)
    return () => clearInterval(interval)
  }, [fetchStatus, fetchLogs, state.status])

  if (loading && !hasInitialized.current) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-6 h-6 text-[var(--text-muted)] animate-spin" />
      </div>
    )
  }

  // Connection Card Content
  const ConnectionContent = () => (
    <>
      {/* Disconnected State */}
      {state.status === 'disconnected' && (
        <div className="text-center py-8">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[var(--bg-surface-soft)] flex items-center justify-center">
            <WifiOff className="w-6 h-6 text-[var(--text-muted)]" />
          </div>
          <h2 className="text-base font-medium text-[var(--text-primary)] mb-1">Connect WhatsApp</h2>
          <p className="text-xs text-[var(--text-secondary)] mb-5">Link your account to extract tasks</p>
          <button
            onClick={handleConnect}
            disabled={actionLoading}
            className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm"
          >
            {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
            Connect
          </button>
        </div>
      )}

      {/* Initializing State */}
      {state.status === 'initializing' && (
        <div className="text-center py-8">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-[var(--accent-light)] flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-[var(--accent-primary)] animate-spin" />
          </div>
          <h2 className="text-base font-medium text-[var(--text-primary)] mb-2">Initializing...</h2>
          <p className="text-sm text-[var(--text-secondary)] mb-4">{state.progressText || 'Starting connection'}</p>
          {elapsedTime > 0 && <p className="text-xs text-[var(--text-muted)] font-mono">{formatTime(elapsedTime)}</p>}
          <button onClick={handleCancel} className="mt-4 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">Cancel</button>
        </div>
      )}

      {/* QR Code Ready State */}
      {state.status === 'qr_ready' && (
        <div className="text-center py-4">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Smartphone className="w-4 h-4 text-[var(--accent-primary)]" />
            <p className="text-sm font-medium text-[var(--text-primary)]">Scan with WhatsApp</p>
          </div>
          
          <div className="inline-block p-4 bg-white rounded-xl shadow-soft border border-[var(--border-subtle)] mb-4">
            {qrImageUrl ? (
              <img 
                src={qrImageUrl} 
                alt="WhatsApp QR Code" 
                className="w-48 h-48 object-contain"
                style={{ imageRendering: 'pixelated', filter: 'grayscale(100%) contrast(1.2)' }}
              />
            ) : (
              <div className="w-48 h-48 flex items-center justify-center bg-[var(--bg-surface-soft)] rounded-lg">
                <Loader2 className="w-8 h-8 text-[var(--text-muted)] animate-spin" />
              </div>
            )}
          </div>

          <div className="text-xs text-[var(--text-secondary)] mb-4 space-y-1">
            <p>1. Open WhatsApp on your phone</p>
            <p>2. Go to Settings → Linked Devices</p>
            <p>3. Tap "Link a Device" and scan</p>
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-[var(--text-muted)] mb-3">
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span>Waiting for scan...</span>
            {elapsedTime > 0 && <span className="font-mono">({formatTime(elapsedTime)})</span>}
          </div>
          
          <p className="text-[10px] text-[var(--text-muted)] mb-3 px-4 italic">{WAITING_TIPS[currentTip]}</p>
          
          <button onClick={handleCancel} disabled={actionLoading} className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">Cancel</button>
        </div>
      )}

      {/* Authenticating State */}
      {state.status === 'authenticating' && (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-emerald-50 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 animate-pulse" />
          </div>
          <h2 className="text-lg font-medium text-[var(--text-primary)] mb-2">QR Scanned!</h2>
          <p className="text-sm text-[var(--text-secondary)]">{state.progressText || 'Authenticating...'}</p>
        </div>
      )}

      {/* Loading Chats State */}
      {state.status === 'loading_chats' && (
        <div className="text-center py-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-[var(--accent-primary)] animate-pulse" />
          </div>
          <h2 className="text-lg font-medium text-[var(--text-primary)] mb-2">Syncing Chats</h2>
          <p className="text-sm text-[var(--text-secondary)] mb-4">{state.progressText || 'Loading your messages...'}</p>
          
          <div className="max-w-xs mx-auto mb-4">
            <div className="h-2 bg-[var(--bg-surface-soft)] rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-[var(--accent-primary)] to-emerald-500 transition-all duration-500 rounded-full"
                style={{ width: `${Math.max(state.progress, 5)}%` }}
              />
            </div>
            <p className="text-xs text-[var(--text-muted)] mt-2 font-mono">{state.progress}% complete</p>
          </div>
          
          {elapsedTime > 0 && <p className="text-xs text-[var(--text-muted)] font-mono">{formatTime(elapsedTime)}</p>}
        </div>
      )}

      {/* Connecting State */}
      {state.status === 'connecting' && (
        <div className="text-center py-8">
          <Loader2 className="w-8 h-8 text-[var(--text-muted)] animate-spin mx-auto mb-4" />
          <h2 className="text-lg font-medium text-[var(--text-primary)] mb-2">Connecting...</h2>
          <p className="text-sm text-[var(--text-secondary)]">Establishing secure connection</p>
        </div>
      )}

      {/* Connected State */}
      {state.status === 'connected' && (
        <div>
          <div className="flex items-center gap-3 mb-6 p-4 bg-emerald-50/50 border border-emerald-100 rounded-xl">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
              <div className="w-3 h-3 bg-emerald-500 rounded-full shadow-[0_0_0_3px_rgba(16,185,129,0.2)]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Connected</h3>
              <p className="text-xs text-[var(--text-secondary)] truncate">Monitoring messages</p>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="p-3 rounded-lg bg-[var(--bg-surface-soft)]/50 border border-[var(--border-subtle)]">
              <p className="text-[10px] text-[var(--text-muted)] mb-0.5">Account</p>
              <p className="text-sm font-medium text-[var(--text-primary)] truncate">{state.user?.phone || 'Unknown'}</p>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-surface-soft)]/50 border border-[var(--border-subtle)]">
              <p className="text-[10px] text-[var(--text-muted)] mb-0.5">Processed</p>
              <p className="text-lg font-semibold text-[var(--text-primary)]">{state.messagesProcessed.toLocaleString()}</p>
            </div>
            <div className="p-3 rounded-lg bg-[var(--bg-surface-soft)]/50 border border-[var(--border-subtle)]">
              <p className="text-[10px] text-[var(--text-muted)] mb-0.5">Status</p>
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <p className="text-sm font-medium text-[var(--text-primary)]">Active</p>
              </div>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2 pt-4 border-t border-[var(--border-subtle)]">
            <button 
              onClick={handleDisconnect} 
              disabled={actionLoading} 
              className="btn-secondary text-xs flex items-center gap-1.5"
            >
              <WifiOff className="w-3.5 h-3.5" />
              Disconnect
            </button>
            <button 
              onClick={handleClearData} 
              disabled={clearingData}
              className="text-xs text-[var(--text-muted)] hover:text-orange-500 px-3 py-1.5 flex items-center gap-1.5"
            >
              {clearingData ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Clear Data
            </button>
            <button 
              onClick={handleLogout} 
              disabled={actionLoading} 
              className="text-xs text-red-500 hover:text-red-600 px-3 py-1.5 font-medium ml-auto flex items-center gap-1.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logout
            </button>
          </div>
        </div>
      )}

      {/* Error State */}
      {state.status === 'error' && (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-50 flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-lg font-medium text-[var(--text-primary)] mb-2">Connection Failed</h2>
          <p className="text-sm text-[var(--text-secondary)] mb-6 max-w-sm mx-auto">{state.error || 'An error occurred'}</p>
          <button onClick={handleConnect} disabled={actionLoading} className="btn-primary inline-flex items-center gap-2">
            {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Try Again
          </button>
        </div>
      )}
    </>
  )

  // Activity Log Component
  const ActivityLog = () => (
    <div className="soft-card overflow-hidden h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-soft)]/30">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-[var(--text-primary)]">Activity</h2>
          <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-surface-soft)] px-1.5 py-0.5 rounded-md">{logs.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={fetchLogs} className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-md">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={clearLogs} className="p-1.5 text-[var(--text-muted)] hover:text-red-500 rounded-md">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-[var(--bg-surface)]">
        {logs.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-[var(--text-muted)]">No activity yet</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {logs.slice(0, 30).map((log) => (
              <div key={log.id} className="flex items-center gap-2 px-4 py-2.5">
                <span className="text-sm shrink-0">{log.icon}</span>
                <p className="text-sm text-[var(--text-primary)] truncate flex-1">{log.title}</p>
                <span className="text-[10px] text-[var(--text-muted)] shrink-0 font-mono">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  // Quick Links Component
  const QuickLinks = () => (
    <div className="soft-card p-4 bg-[var(--bg-surface)]">
      <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-3">Quick Links</h3>
      <div className="space-y-2">
        <Link 
          to="/dashboard" 
          className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--bg-surface-soft)] transition-colors group"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <Inbox className="w-4 h-4 text-blue-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">Inbox</p>
            <p className="text-xs text-[var(--text-muted)]">View all messages</p>
          </div>
          <ArrowRight className="w-4 h-4 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
        </Link>
        <Link 
          to="/tasks" 
          className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--bg-surface-soft)] transition-colors group"
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
            <CheckSquare className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">Tasks</p>
            <p className="text-xs text-[var(--text-muted)]">Manage your to-dos</p>
          </div>
          <ArrowRight className="w-4 h-4 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
        </Link>
        <Link 
          to="/search" 
          className="flex items-center gap-3 p-3 rounded-lg hover:bg-[var(--bg-surface-soft)] transition-colors group"
        >
          <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
            <Search className="w-4 h-4 text-purple-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">AI Search</p>
            <p className="text-xs text-[var(--text-muted)]">Find anything with AI</p>
          </div>
          <ArrowRight className="w-4 h-4 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
        </Link>
      </div>
    </div>
  )

  // Recent Messages Preview
  const RecentMessages = () => {
    const [recentMsgs, setRecentMsgs] = useState<any[]>([])
    const [loadingMsgs, setLoadingMsgs] = useState(true)

    useEffect(() => {
      const fetchRecent = async () => {
        try {
          const res = await fetch(`${API_BASE}/messages?limit=5`)
          const json = await res.json()
          if (json.success) {
            setRecentMsgs(json.data || [])
          }
        } catch (err) {
          console.error('Failed to fetch recent messages:', err)
        } finally {
          setLoadingMsgs(false)
        }
      }
      fetchRecent()
    }, [state.status])

    if (loadingMsgs) {
      return (
        <div className="soft-card p-4 bg-[var(--bg-surface)]">
          <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-3">Recent Messages</h3>
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 text-[var(--text-muted)] animate-spin" />
          </div>
        </div>
      )
    }

    if (recentMsgs.length === 0) {
      return (
        <div className="soft-card p-4 bg-[var(--bg-surface)]">
          <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-3">Recent Messages</h3>
          <div className="text-center py-6">
            <MessageSquare className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-2 opacity-50" />
            <p className="text-sm text-[var(--text-muted)]">No messages yet</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Connect WhatsApp to start</p>
          </div>
        </div>
      )
    }

    return (
      <div className="soft-card p-4 bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Recent Messages</h3>
          <Link to="/dashboard" className="text-xs text-[var(--accent-primary)] hover:underline">View all</Link>
        </div>
        <div className="space-y-2">
          {recentMsgs.slice(0, 4).map((msg, idx) => (
            <div key={msg.id || idx} className="flex items-start gap-3 p-2 rounded-lg hover:bg-[var(--bg-surface-soft)] transition-colors">
              <div className="w-8 h-8 rounded-full bg-[var(--bg-surface-soft)] flex items-center justify-center shrink-0">
                <span className="text-xs font-medium text-[var(--text-secondary)]">
                  {(msg.sender || 'U').charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">{msg.sender || 'Unknown'}</p>
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                    {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] truncate">{msg.content || 'No content'}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      {/* Desktop Layout - Two columns */}
      <div className="hidden lg:flex flex-1 gap-6 p-6 max-w-7xl mx-auto w-full">
        {/* Left: Connection + Quick Links + Recent Messages */}
        <div className="w-[420px] shrink-0 space-y-4">
          <div className="soft-card p-6 bg-[var(--bg-surface)]">
            <ConnectionContent />
          </div>
          {state.status === 'connected' && (
            <>
              <QuickLinks />
              <RecentMessages />
            </>
          )}
        </div>
        
        {/* Right: Activity Log - takes remaining space */}
        <div className="flex-1 min-w-0 min-h-[calc(100vh-120px)]">
          <ActivityLog />
        </div>
      </div>

      {/* Mobile Layout - Single column (unchanged) */}
      <div className="lg:hidden flex-1 overflow-y-auto px-4 py-4">
        <div className="w-full max-w-md mx-auto">
          <div className="soft-card p-6 bg-[var(--bg-surface)]">
            <ConnectionContent />
          </div>
          
          <div className="mt-4 h-[400px]">
            <ActivityLog />
          </div>
        </div>
      </div>
    </div>
  )
}
