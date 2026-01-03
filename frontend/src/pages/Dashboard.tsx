/**
 * Dashboard Page - Superhuman/Linear Style
 * Polished, grid-based overview with soft shadows and depth
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { 
  RefreshCw,
  MessageSquare,
  CheckSquare,
  ArrowRight,
  Activity,
  Clock,
  Loader2
} from 'lucide-react'
import { API_BASE } from '../services/api'

interface Stats {
  overview: {
    total_messages: number
    recent_24h: number
    tasks_created: number
    pending_review: number
  }
  by_classification: Record<string, number>
  by_decision: Record<string, number>
  by_priority: Record<string, number>
}

interface RecentTask {
  id: string
  title: string
  priority: string
  category: string
  time: string
  date: string
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const statsRes = await fetch(`${API_BASE}/stats`)
      const statsJson = await statsRes.json()
      if (statsJson.success) {
        setStats(statsJson.data)
      }

      const tasksRes = await fetch(`${API_BASE}/messages?decision=create&limit=5`)
      const tasksJson = await tasksRes.json()
      if (tasksJson.success) {
        setRecentTasks(tasksJson.data.map((msg: any) => ({
          id: msg.id,
          title: msg.metadata?.suggestedTask || msg.content.slice(0, 80),
          priority: msg.priority || 'medium',
          category: msg.classification || 'personal',
          time: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          date: new Date(msg.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })
        })))
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-6 h-6 text-[var(--text-muted)] animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mb-4">
          <Activity className="w-6 h-6 text-red-500" />
        </div>
        <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">Unable to load dashboard</h3>
        <p className="text-[var(--text-secondary)] mb-6 max-w-sm">{error}</p>
        <button 
          onClick={loadData} 
          className="btn-primary"
        >
          Try again
        </button>
      </div>
    )
  }

  const totalMessages = stats?.overview.total_messages || 0
  const recent24h = stats?.overview.recent_24h || 0
  const tasksCreated = stats?.overview.tasks_created || 0
  const pendingReview = stats?.overview.pending_review || 0

  return (
    <div className="space-y-6 sm:space-y-8 animate-fade-in pb-10 overflow-hidden w-full relative max-w-full">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-semibold text-[var(--text-primary)] tracking-tight">Dashboard</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Overview of your activity</p>
        </div>
        <button 
          onClick={loadData}
          className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-soft)] rounded-lg transition-colors"
          title="Refresh Data"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="soft-card p-5 group hover:border-[var(--accent-primary)]/20 transition-colors">
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 group-hover:scale-110 transition-transform">
              <MessageSquare className="w-5 h-5" />
            </div>
            <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full">
              +12%
            </span>
          </div>
          <p className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight truncate">{totalMessages.toLocaleString()}</p>
          <p className="text-sm text-[var(--text-secondary)] mt-1 truncate">Total Messages</p>
        </div>

        <div className="soft-card p-5 group hover:border-[var(--accent-primary)]/20 transition-colors">
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 group-hover:scale-110 transition-transform shrink-0">
              <CheckSquare className="w-5 h-5" />
            </div>
            <span className="text-xs font-medium text-[var(--text-muted)] bg-[var(--bg-surface-soft)] px-2 py-1 rounded-full shrink-0">
              All time
            </span>
          </div>
          <p className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight truncate">{tasksCreated.toLocaleString()}</p>
          <p className="text-sm text-[var(--text-secondary)] mt-1 truncate">Tasks Created</p>
        </div>

        <div className="soft-card p-5 group hover:border-[var(--accent-primary)]/20 transition-colors">
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 group-hover:scale-110 transition-transform">
              <Clock className="w-5 h-5" />
            </div>
            {pendingReview > 0 && (
              <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded-full animate-pulse">
                Action needed
              </span>
            )}
          </div>
          <p className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight">{pendingReview}</p>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Pending Review</p>
        </div>

        <div className="soft-card p-5 group hover:border-[var(--accent-primary)]/20 transition-colors">
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 group-hover:scale-110 transition-transform">
              <Activity className="w-5 h-5" />
            </div>
            <span className="text-xs font-medium text-[var(--text-muted)] bg-[var(--bg-surface-soft)] px-2 py-1 rounded-full">
              Last 24h
            </span>
          </div>
          <p className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight">{recent24h}</p>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Recent Activity</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Recent Tasks Column */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">Recent Tasks</h2>
            <Link to="/tasks" className="text-xs font-medium text-[var(--accent-primary)] hover:text-[var(--accent-hover)] flex items-center gap-1 group">
              View all <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </div>

          <div className="soft-card overflow-hidden">
            {recentTasks.length === 0 ? (
              <div className="py-12 text-center">
                <div className="w-12 h-12 bg-[var(--bg-surface-soft)] rounded-full flex items-center justify-center mx-auto mb-3">
                  <CheckSquare className="w-5 h-5 text-[var(--text-muted)]" />
                </div>
                <p className="text-[var(--text-primary)] font-medium">No tasks yet</p>
                <p className="text-sm text-[var(--text-secondary)] mt-1">
                  Tasks extracted from WhatsApp will appear here
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {recentTasks.map((task) => (
                  <Link
                    key={task.id}
                    to="/tasks"
                    className="flex items-center gap-4 p-4 hover:bg-[var(--bg-surface-soft)]/50 transition-colors group"
                  >
                    <div className={`w-2 h-2 rounded-full shrink-0 priority-dot priority-${task.priority}`} />
                    
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate group-hover:text-[var(--accent-primary)] transition-colors">
                        {task.title}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-[var(--text-secondary)] capitalize bg-[var(--bg-surface-soft)] px-1.5 py-0.5 rounded border border-[var(--border-subtle)]">
                          {task.category}
                        </span>
                        <span className="text-xs text-[var(--text-muted)]">
                          • {task.date}
                        </span>
                      </div>
                    </div>
                    
                    <div className="text-xs text-[var(--text-muted)] font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                      {task.time}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Categories Column */}
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider px-1">Distribution</h2>
          
          <div className="soft-card p-5">
            {Object.keys(stats?.by_classification || {}).length === 0 ? (
              <div className="text-center py-8 text-[var(--text-muted)] text-sm">
                No data available
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(stats?.by_classification || {}).map(([category, count]) => {
                  const percentage = Math.round((count / (stats?.overview.total_messages || 1)) * 100)
                  return (
                    <div key={category}>
                      <div className="flex items-center justify-between text-sm mb-1.5">
                        <span className="capitalize text-[var(--text-primary)]">{category}</span>
                        <span className="text-[var(--text-secondary)] font-mono text-xs">{count}</span>
                      </div>
                      <div className="h-1.5 bg-[var(--bg-surface-soft)] rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-[var(--accent-primary)] opacity-80 rounded-full"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
