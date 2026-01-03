/**
 * Connect Page - Notion-style Design
 * Simple, minimal QR display and status
 */

import { useEffect, useState, useCallback, useRef } from 'react'
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
  PartyPopper
} from 'lucide-react'
import { API_BASE } from '../services/api'

// Tips for waiting time
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
  const [elapsedTime, setElapsedTime] = useState(0)
  const [currentTip, setCurrentTip] = useState(0)
  const [showSuccess, setShowSuccess] = useState(false)
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null)
  const sseRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevStatusRef = useRef<string>('disconnected')

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/whatsapp/status`)
      const json = await res.json()
      if (json.success) setState(json.data)
    } catch (err) {
      console.error('Failed to fetch status:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Handle QR code image loading
  useEffect(() => {
    if (state.status === 'qr_ready') {
      // Use data URL from state if available (base64)
      if (state.qrCode && state.qrCode.startsWith('data:')) {
        setQrImageUrl(state.qrCode)
      } else if (state.qrCode && state.qrCode.startsWith('http')) {
        setQrImageUrl(state.qrCode)
      } else {
        // Fallback to proxy endpoint
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
        // Refresh every 55 seconds to match backend QR timeout (~60 seconds)
        const interval = setInterval(loadQr, 55000)
        return () => {
          clearInterval(interval)
        }
      }
    } else {
      setQrImageUrl(prev => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
        return null
      })
    }
  }, [state.status, state.qrCode])

  // Detect status change to connected - show celebration
  useEffect(() => {
    if (prevStatusRef.current !== 'connected' && state.status === 'connected') {
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 3000)
    }
    prevStatusRef.current = state.status
  }, [state.status])

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

  useEffect(() => {
    fetchStatus()
    fetchLogs()
  }, [fetchStatus, fetchLogs])

  // SSE with auto-reconnect for WhatsApp status
  const connectSSE = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close()
    }

    const eventSource = new EventSource(`${API_BASE}/whatsapp/events`)
    sseRef.current = eventSource

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        setState(data)
      } catch (err) {}
    }

    eventSource.onerror = () => {
      eventSource.close()
      sseRef.current = null
      // Auto-reconnect after 2 seconds
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        connectSSE()
      }, 2000)
    }
  }, [])

  // Cleanup SSE on unmount
  useEffect(() => {
    connectSSE()
    return () => {
      if (sseRef.current) {
        sseRef.current.close()
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
    }
  }, [connectSSE])

  // Polling fallback - faster during active connection states
  useEffect(() => {
    const activeStates = ['initializing', 'qr_ready', 'connecting', 'authenticating', 'loading_chats']
    const pollInterval = activeStates.includes(state.status) ? 2000 : 10000
    
    const interval = setInterval(() => {
      fetchStatus()
      fetchLogs()
    }, pollInterval)
    return () => clearInterval(interval)
  }, [fetchStatus, fetchLogs, state.status])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-6 h-6 text-[var(--text-muted)] animate-spin" />
      </div>
    )
  }

  return (
    <div className="w-full max-w-md mx-auto px-1 overflow-hidden">
      {/* Success Celebration Overlay */}
      {showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 shadow-2xl text-center transform animate-pulse">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
              <PartyPopper className="w-10 h-10 text-emerald-500" />
            </div>
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-2">Connected!</h2>
            <p className="text-sm text-[var(--text-secondary)]">WhatsApp is now linked</p>
          </div>
        </div>
      )}

      {/* Main Connection Area */}
      <div className="soft-card p-4 sm:p-6 md:p-8 bg-[var(--bg-surface)] relative overflow-hidden">

        {/* Disconnected State */}
        {state.status === 'disconnected' && (
          <div className="text-center py-6 sm:py-8 relative z-10">
            <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 rounded-2xl bg-[var(--bg-surface-soft)] flex items-center justify-center shadow-soft-sm">
              <WifiOff className="w-6 h-6 sm:w-8 sm:h-8 text-[var(--text-muted)]" />
            </div>
            <h2 className="text-base sm:text-lg font-medium text-[var(--text-primary)] mb-1">Connect WhatsApp</h2>
            <p className="text-xs text-[var(--text-secondary)] mb-5">
              Link your account to extract tasks
            </p>
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
          <div className="text-center py-6 sm:py-8 relative z-10">
            <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 sm:mb-6 rounded-full bg-[var(--accent-light)] flex items-center justify-center">
              <Loader2 className="w-6 h-6 sm:w-8 sm:h-8 text-[var(--accent-primary)] animate-spin" />
            </div>
            <h2 className="text-base sm:text-lg font-medium text-[var(--text-primary)] mb-2">Initializing...</h2>
            <p className="text-sm text-[var(--text-secondary)] mb-4 px-2">
              {state.progressText || 'Starting connection'}
            </p>
            {elapsedTime > 0 && (
              <p className="text-xs text-[var(--text-muted)] font-mono">
                {formatTime(elapsedTime)}
              </p>
            )}
            <button
              onClick={handleCancel}
              className="mt-4 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* QR Code Ready State */}
        {state.status === 'qr_ready' && (
          <div className="text-center py-2 relative z-10">
            <div className="flex items-center justify-center gap-2 mb-4">
              <Smartphone className="w-4 h-4 text-[var(--accent-primary)]" />
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Scan with WhatsApp
              </p>
            </div>
            
            {/* QR Code */}
            <div className="inline-block p-4 bg-white rounded-xl shadow-soft border border-[var(--border-subtle)] mb-4">
              {qrImageUrl ? (
                <img 
                  src={qrImageUrl} 
                  alt="WhatsApp QR Code" 
                  className="w-48 h-48 sm:w-56 sm:h-56 object-contain"
                  style={{ imageRendering: 'pixelated', filter: 'grayscale(100%) contrast(1.2)' }}
                />
              ) : (
                <div className="w-48 h-48 sm:w-56 sm:h-56 flex items-center justify-center bg-[var(--bg-surface-soft)] rounded-lg">
                  <Loader2 className="w-8 h-8 text-[var(--text-muted)] animate-spin" />
                </div>
              )}
            </div>

            {/* Instructions */}
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
            
            {/* Helpful tip */}
            <p className="text-[10px] text-[var(--text-muted)] mb-3 px-4 italic">
              {WAITING_TIPS[currentTip]}
            </p>
            
            <button
              onClick={handleCancel}
              disabled={actionLoading}
              className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Authenticating State */}
        {state.status === 'authenticating' && (
          <div className="text-center py-8 relative z-10">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 animate-pulse" />
            </div>
            <h2 className="text-lg font-medium text-[var(--text-primary)] mb-2">QR Scanned!</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              {state.progressText || 'Authenticating...'}
            </p>
          </div>
        )}

        {/* Loading Chats State */}
        {state.status === 'loading_chats' && (
          <div className="text-center py-6 relative z-10">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-[var(--accent-primary)] animate-pulse" />
            </div>
            <h2 className="text-lg font-medium text-[var(--text-primary)] mb-2">Syncing Chats</h2>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              {state.progressText || 'Loading your messages...'}
            </p>
            
            {/* Progress Bar */}
            <div className="max-w-xs mx-auto mb-4">
              <div className="h-2 bg-[var(--bg-surface-soft)] rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-[var(--accent-primary)] to-emerald-500 transition-all duration-500 ease-out rounded-full"
                  style={{ width: `${Math.max(state.progress, 5)}%` }}
                />
              </div>
              <p className="text-xs text-[var(--text-muted)] mt-2 font-mono">
                {state.progress}% complete
              </p>
            </div>
            
            {elapsedTime > 60 && (
              <p className="text-xs text-[var(--text-secondary)] mb-2 px-4">
                Large chat histories can take a few minutes...
              </p>
            )}
            {elapsedTime > 0 && (
              <p className="text-xs text-[var(--text-muted)] font-mono">
                {formatTime(elapsedTime)}
              </p>
            )}
          </div>
        )}

        {/* Connecting State */}
        {state.status === 'connecting' && (
          <div className="text-center py-8 relative z-10">
            <Loader2 className="w-8 h-8 text-[var(--text-muted)] animate-spin mx-auto mb-4" />
            <h2 className="text-lg font-medium text-[var(--text-primary)] mb-2">Connecting...</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Establishing secure connection
            </p>
          </div>
        )}

        {/* Connected State */}
        {state.status === 'connected' && (
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4 sm:mb-6 p-3 sm:p-4 bg-emerald-50/50 border border-emerald-100 rounded-xl">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 bg-emerald-500 rounded-full shadow-[0_0_0_3px_rgba(16,185,129,0.2)]" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Connected</h3>
                <p className="text-xs text-[var(--text-secondary)] truncate">Monitoring messages</p>
              </div>
            </div>
            
            <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-6">
              <div className="p-2 sm:p-3 rounded-lg bg-[var(--bg-surface-soft)]/50 border border-[var(--border-subtle)]">
                <p className="text-[10px] sm:text-xs text-[var(--text-muted)] mb-0.5">Account</p>
                <p className="text-xs sm:text-sm font-medium text-[var(--text-primary)] truncate">
                  {state.user?.name || 'Unknown'}
                </p>
              </div>
              <div className="p-2 sm:p-3 rounded-lg bg-[var(--bg-surface-soft)]/50 border border-[var(--border-subtle)]">
                <p className="text-[10px] sm:text-xs text-[var(--text-muted)] mb-0.5">Processed</p>
                <p className="text-sm sm:text-lg font-semibold text-[var(--text-primary)]">
                  {state.messagesProcessed.toLocaleString()}
                </p>
              </div>
              <div className="p-2 sm:p-3 rounded-lg bg-[var(--bg-surface-soft)]/50 border border-[var(--border-subtle)]">
                <p className="text-[10px] sm:text-xs text-[var(--text-muted)] mb-0.5">Status</p>
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <p className="text-xs sm:text-sm font-medium text-[var(--text-primary)]">Active</p>
                </div>
              </div>
            </div>
            
            <div className="flex gap-3 pt-4 border-t border-[var(--border-subtle)]">
              <button
                onClick={handleDisconnect}
                disabled={actionLoading}
                className="btn-secondary text-xs"
              >
                Disconnect
              </button>
              <button
                onClick={handleLogout}
                disabled={actionLoading}
                className="text-xs text-red-500 hover:text-red-600 px-4 py-2 font-medium transition-colors ml-auto"
              >
                Logout
              </button>
            </div>
          </div>
        )}

        {/* Error State */}
        {state.status === 'error' && (
          <div className="text-center py-8 relative z-10">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-50 flex items-center justify-center">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-lg font-medium text-[var(--text-primary)] mb-2">Connection Failed</h2>
            <p className="text-sm text-[var(--text-secondary)] mb-6 max-w-sm mx-auto">
              {state.error || 'An error occurred while connecting'}
            </p>
            <button
              onClick={handleConnect}
              disabled={actionLoading}
              className="btn-primary inline-flex items-center gap-2"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Try Again
            </button>
          </div>
        )}
      </div>

      {/* Activity Log */}
      <div className="soft-card overflow-hidden mt-4 sm:mt-6">
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-soft)]/30">
          <div className="flex items-center gap-2">
            <h2 className="text-xs sm:text-sm font-medium text-[var(--text-primary)]">Activity</h2>
            <span className="text-[10px] sm:text-xs text-[var(--text-muted)] bg-[var(--bg-surface-soft)] px-1.5 py-0.5 rounded-md">
              {logs.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={fetchLogs}
              className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-md transition-colors"
            >
              <RefreshCw className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </button>
            <button
              onClick={clearLogs}
              className="p-1.5 text-[var(--text-muted)] hover:text-red-500 rounded-md transition-colors"
            >
              <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </button>
          </div>
        </div>

        <div className="max-h-[180px] sm:max-h-[220px] overflow-y-auto bg-[var(--bg-surface)]">
          {logs.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-xs sm:text-sm text-[var(--text-muted)]">No activity yet</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-subtle)]">
              {logs.slice(0, 10).map((log) => (
                <div key={log.id} className="flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5">
                  <span className="text-sm shrink-0">{log.icon}</span>
                  <p className="text-xs sm:text-sm text-[var(--text-primary)] truncate flex-1">{log.title}</p>
                  <span className="text-[9px] sm:text-[10px] text-[var(--text-muted)] shrink-0 font-mono">
                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
