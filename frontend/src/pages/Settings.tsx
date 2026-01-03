import { useEffect, useState, useCallback } from 'react'
import { 
  RefreshCw,
  Moon,
  Sun,
  Trash2,
  Loader2
} from 'lucide-react'
import clsx from 'clsx'
import { API_BASE } from '../services/api'

interface HealthStatus {
  status: string
  timestamp: string
  services: {
    supabase: boolean
    gemini: boolean
    whatsapp: string
  }
}

interface WhatsAppState {
  status: string
  user: { name: string; phone: string } | null
}

function SettingToggle({ 
  label, 
  description, 
  enabled, 
  onChange 
}: { 
  label: string
  description: string
  enabled: boolean
  onChange: (enabled: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div>
        <p className="text-sm text-[var(--text-primary)]">{label}</p>
        <p className="text-xs text-[var(--text-muted)]">{description}</p>
      </div>
      <button
        onClick={() => onChange(!enabled)}
        className={clsx(
          'w-10 h-5 rounded-full p-0.5 transition-colors',
          enabled ? 'bg-[var(--text-primary)]' : 'bg-[var(--bg-tertiary)]'
        )}
      >
        <div className={clsx(
          'w-4 h-4 rounded-full bg-white transition-transform',
          enabled ? 'translate-x-5' : 'translate-x-0'
        )} />
      </button>
    </div>
  )
}

export default function Settings() {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [whatsappState, setWhatsappState] = useState<WhatsAppState | null>(null)
  const [loading, setLoading] = useState(true)
  const [darkMode, setDarkMode] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [settings, setSettings] = useState({
    aiEnabled: true,
    autoStart: true,
    notifications: true,
    autoClassify: true
  })
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    const isDark = localStorage.getItem('darkMode') === 'true'
    setDarkMode(isDark)
    
    const savedSettings = localStorage.getItem('appSettings')
    if (savedSettings) {
      setSettings(JSON.parse(savedSettings))
    }
  }, [])

  const saveSettings = (newSettings: typeof settings) => {
    setSettings(newSettings)
    localStorage.setItem('appSettings', JSON.stringify(newSettings))
  }

  const toggleDarkMode = () => {
    const newMode = !darkMode
    setDarkMode(newMode)
    localStorage.setItem('darkMode', String(newMode))
    document.documentElement.classList.toggle('dark', newMode)
  }

  const fetchHealth = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/health`)
      const json = await res.json()
      setHealth(json)
    } catch (err) {
      console.error('Failed to fetch health:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch WhatsApp status separately for accurate connection status
  const fetchWhatsAppStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/whatsapp/status`)
      const json = await res.json()
      if (json.success) {
        setWhatsappState(json.data)
      }
    } catch (err) {
      console.error('Failed to fetch WhatsApp status:', err)
    }
  }, [])

  useEffect(() => {
    fetchHealth()
    fetchWhatsAppStatus()
    
    // Poll WhatsApp status every 5 seconds
    const interval = setInterval(fetchWhatsAppStatus, 5000)
    return () => clearInterval(interval)
  }, [fetchHealth, fetchWhatsAppStatus])

  const testClassification = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch(`${API_BASE}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Meeting tomorrow at 3pm with the team to discuss project' })
      })
      const json = await res.json()
      if (json.success) {
        setTestResult({
          success: true,
          message: `Category: ${json.data.category}, Priority: ${json.data.priority}`
        })
      } else {
        setTestResult({ success: false, message: json.error })
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message })
    } finally {
      setTesting(false)
    }
  }

  const clearAllData = async () => {
    if (!confirm('Are you sure you want to clear all messages and tasks? This cannot be undone.')) return
    
    setClearing(true)
    try {
      // Clear logs
      await fetch(`${API_BASE}/logs`, { method: 'DELETE' })
      
      // Clear messages
      await fetch(`${API_BASE}/messages/clear`, { method: 'DELETE' })
      
      // Clear action items
      await fetch(`${API_BASE}/actions/clear`, { method: 'DELETE' })
      
      alert('All data cleared successfully!')
    } catch (err) {
      console.error('Failed to clear data:', err)
      alert('Failed to clear some data. Check console for details.')
    } finally {
      setClearing(false)
    }
  }

  // Use whatsappState for accurate connection status
  const isWhatsAppConnected = whatsappState?.status === 'connected'

  return (
    <div className="max-w-xl mx-auto overflow-hidden pb-10 px-4">
      {/* Header */}
      <h1 className="text-xl font-semibold text-[var(--text-primary)] mb-1">Settings</h1>
      <p className="text-sm text-[var(--text-muted)] mb-6 sm:mb-8">Manage your preferences</p>

      {/* Connection Status */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">Status</h2>
          <button 
            onClick={() => { fetchHealth(); fetchWhatsAppStatus(); }}
            className="p-1 rounded hover:bg-[var(--bg-hover)]"
          >
            <RefreshCw className={clsx('w-3.5 h-3.5 text-[var(--text-muted)]', loading && 'animate-spin')} />
          </button>
        </div>
        
        <div className="text-sm space-y-1">
          <div className="flex items-center gap-2">
            <span className={clsx(
              'w-2 h-2 rounded-full',
              isWhatsAppConnected ? 'bg-green-500' : 'bg-gray-400'
            )} />
            <span className="text-[var(--text-primary)]">WhatsApp</span>
            <span className="text-[var(--text-muted)]">
              {isWhatsAppConnected ? 'Connected' : 'Disconnected'}
            </span>
            {whatsappState?.user && (
              <span className="text-[var(--text-muted)] text-xs">({whatsappState.user.phone})</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={clsx(
              'w-2 h-2 rounded-full',
              health?.services.gemini ? 'bg-green-500' : 'bg-gray-400'
            )} />
            <span className="text-[var(--text-primary)]">AI (Gemini)</span>
            <span className="text-[var(--text-muted)]">
              {health?.services.gemini ? 'Active' : 'Inactive'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={clsx(
              'w-2 h-2 rounded-full',
              health?.services.supabase ? 'bg-green-500' : 'bg-gray-400'
            )} />
            <span className="text-[var(--text-primary)]">Database</span>
            <span className="text-[var(--text-muted)]">
              {health?.services.supabase ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </section>

      <div className="divider" />

      {/* AI Settings */}
      <section className="mb-8">
        <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-3">AI Classification</h2>
        
        <SettingToggle
          label="Enable AI"
          description="Use Gemini AI to classify messages"
          enabled={settings.aiEnabled}
          onChange={(v) => saveSettings({ ...settings, aiEnabled: v })}
        />
        <SettingToggle
          label="Auto-classify"
          description="Automatically classify incoming messages"
          enabled={settings.autoClassify}
          onChange={(v) => saveSettings({ ...settings, autoClassify: v })}
        />

        <button
          onClick={testClassification}
          disabled={testing}
          className="notion-btn text-sm mt-2 flex items-center gap-2"
        >
          {testing && <RefreshCw className="w-3 h-3 animate-spin" />}
          Test Classification
        </button>
        
        {testResult && (
          <p className={clsx(
            'text-xs mt-2',
            testResult.success ? 'text-green-600' : 'text-red-500'
          )}>
            {testResult.message}
          </p>
        )}
      </section>

      <div className="divider" />

      {/* Appearance */}
      <section className="mb-8">
        <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-3">Appearance</h2>
        
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-2">
            {darkMode ? <Moon className="w-4 h-4 text-[var(--text-muted)]" /> : <Sun className="w-4 h-4 text-[var(--text-muted)]" />}
            <span className="text-sm text-[var(--text-primary)]">Dark Mode</span>
          </div>
          <button
            onClick={toggleDarkMode}
            className={clsx(
              'w-10 h-5 rounded-full p-0.5 transition-colors',
              darkMode ? 'bg-[var(--text-primary)]' : 'bg-[var(--bg-tertiary)]'
            )}
          >
            <div className={clsx(
              'w-4 h-4 rounded-full bg-white transition-transform',
              darkMode ? 'translate-x-5' : 'translate-x-0'
            )} />
          </button>
        </div>
      </section>

      <div className="divider" />

      {/* WhatsApp */}
      <section className="mb-8">
        <h2 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-3">WhatsApp</h2>
        
        <SettingToggle
          label="Auto-start"
          description="Connect to WhatsApp when app starts"
          enabled={settings.autoStart}
          onChange={(v) => saveSettings({ ...settings, autoStart: v })}
        />
        <SettingToggle
          label="Notifications"
          description="Get notified when new tasks are created"
          enabled={settings.notifications}
          onChange={(v) => saveSettings({ ...settings, notifications: v })}
        />
      </section>

      <div className="divider" />

      {/* Danger Zone */}
      <section>
        <h2 className="text-xs font-medium text-red-500 uppercase tracking-wide mb-3">Danger Zone</h2>
        
        <div className="flex items-center justify-between py-3">
          <div>
            <p className="text-sm text-[var(--text-primary)]">Clear All Data</p>
            <p className="text-xs text-[var(--text-muted)]">Delete all messages, tasks, and logs</p>
          </div>
          <button
            onClick={clearAllData}
            disabled={clearing}
            className="text-sm text-red-500 hover:text-red-600 flex items-center gap-1"
          >
            {clearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            {clearing ? 'Clearing...' : 'Clear'}
          </button>
        </div>
      </section>

      {/* Version */}
      <p className="text-xs text-[var(--text-muted)] text-center mt-8">
        Mindline v1.0
      </p>
    </div>
  )
}
