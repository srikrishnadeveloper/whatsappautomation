/**
 * Layout Component - Notion-style
 * Minimal sidebar, clean workspace area
 */

import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { 
  Inbox,
  FileText, 
  Settings, 
  Menu, 
  Smartphone,
  CheckSquare,
  Moon,
  Sun,
  LogOut,
  ChevronDown,
  Search
} from 'lucide-react'
import { useState, useEffect } from 'react'
import clsx from 'clsx'
import { useAuth } from '../context/AuthContext'
import { API_BASE } from '../services/api'

const navigation = [
  { name: 'Inbox', href: '/dashboard', icon: Inbox },
  { name: 'Tasks', href: '/tasks', icon: CheckSquare },
  { name: 'AI Search', href: '/search', icon: Search },
  { name: 'Summary', href: '/summary', icon: FileText },
  { name: 'Connect WhatsApp', href: '/', icon: Smartphone },
  { name: 'Settings', href: '/settings', icon: Settings },
]

interface WhatsAppStatus {
  status: 'connected' | 'disconnected' | 'connecting' | 'qr_ready' | 'initializing' | 'error'
  messagesProcessed: number
  user?: { name: string; phone: string } | null
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const [waStatus, setWaStatus] = useState<WhatsAppStatus>({ 
    status: 'disconnected', 
    messagesProcessed: 0 
  })
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  useEffect(() => {
    const isDark = localStorage.getItem('darkMode') === 'true'
    setDarkMode(isDark)
    document.documentElement.classList.toggle('dark', isDark)
  }, [])

  const toggleDarkMode = () => {
    const newMode = !darkMode
    setDarkMode(newMode)
    localStorage.setItem('darkMode', String(newMode))
    document.documentElement.classList.toggle('dark', newMode)
  }

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/whatsapp/status`)
        const json = await res.json()
        if (json.success) {
          setWaStatus(json.data)
        }
      } catch (err) {}
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const eventSource = new EventSource(`${API_BASE}/whatsapp/events`)
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        setWaStatus(data)
      } catch (err) {}
    }
    eventSource.onerror = () => eventSource.close()
    return () => eventSource.close()
  }, [])

  const isConnected = waStatus.status === 'connected'

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] flex font-sans text-[var(--text-primary)] overflow-x-hidden w-full">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={clsx(
        "fixed top-0 left-0 z-50 h-full w-64 bg-[var(--bg-surface)] border-r border-[var(--border-subtle)] flex flex-col lg:translate-x-0 transition-transform duration-300 ease-in-out shadow-soft-lg lg:shadow-none",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Workspace Header */}
        <div className="px-4 py-5 mb-2">
          <div className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-surface-soft)] cursor-pointer transition-colors group">
            <img src="/mindline-logo.png" alt="Mindline Logo" className="w-8 h-8 object-contain" />
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-semibold text-[var(--text-primary)] truncate leading-tight">
                Mindline
              </h1>
              <p className="text-xs text-[var(--text-muted)] truncate">
                Productivity
              </p>
            </div>
            <ChevronDown className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          <div className="px-3 mb-2 text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
            Menu
          </div>
          {navigation.map((item) => {
            const isActive = location.pathname === item.href
            return (
              <NavLink
                key={item.name}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) => clsx(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 group relative",
                  isActive 
                    ? "bg-[var(--accent-light)] text-[var(--accent-primary)]" 
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-soft)] hover:text-[var(--text-primary)]"
                )}
              >
                <item.icon className={clsx(
                  "w-[18px] h-[18px] transition-colors",
                  isActive ? "text-[var(--accent-primary)]" : "text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]"
                )} />
                <span>{item.name}</span>
                {item.name === 'Connect WhatsApp' && isConnected && (
                  <span className="absolute right-3 w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_0_2px_var(--bg-surface)]" />
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Bottom Section */}
        <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          {/* User Profile */}
          {user && (
            <div className="flex items-center gap-3 px-2 py-2 mb-2 rounded-lg hover:bg-[var(--bg-surface-soft)] transition-colors cursor-pointer">
              <div className="w-8 h-8 rounded-full bg-[var(--bg-surface-soft)] border border-[var(--border-subtle)] flex items-center justify-center text-xs font-medium text-[var(--text-secondary)]">
                {user.fullName?.charAt(0) || user.email.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {user.fullName || 'User'}
                </p>
                <p className="text-xs text-[var(--text-muted)] truncate">
                  {user.email}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 mt-2">
            <button
              onClick={toggleDarkMode}
              className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-[var(--text-secondary)] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md hover:bg-[var(--bg-surface-soft)] hover:text-[var(--text-primary)] transition-all"
            >
              {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              {darkMode ? 'Light' : 'Dark'}
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-red-600 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-md hover:bg-red-50 hover:border-red-100 transition-all"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logout
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 lg:ml-64 min-h-screen flex flex-col transition-all duration-300 min-w-0 w-full">
        {/* Top bar - mobile only */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/80 backdrop-blur-md sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              className="p-2 -ml-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-surface-soft)] transition-colors"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {navigation.find(n => n.href === location.pathname)?.name || 'Mindline'}
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-2 sm:p-6 lg:p-8 max-w-6xl mx-auto w-full animate-fade-in overflow-x-hidden relative">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
