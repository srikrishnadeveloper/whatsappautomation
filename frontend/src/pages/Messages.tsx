import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { 
  Search, 
  RefreshCw, 
  Trash2,
  X,
  MessageSquare
} from 'lucide-react'
import clsx from 'clsx'
import { API_BASE } from '../services/api'

interface Message {
  id: string
  sender: string
  chat_name: string | null
  content: string
  message_type: string
  classification: string | null
  decision: string | null
  priority: string | null
  ai_reasoning: string | null
  created_at: string
  metadata?: any
}

function MessageRow({ 
  message, 
  onDelete, 
  onUpdate 
}: { 
  message: Message
  onDelete: (id: string) => void
  onUpdate: (id: string, updates: Partial<Message>) => void
}) {
  const [expanded, setExpanded] = useState(false)

  const formatTime = (date: string) => {
    const d = new Date(date)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    const hours = diff / (1000 * 60 * 60)
    
    if (hours < 24) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    } else if (hours < 48) {
      return 'Yesterday'
    } else {
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
    }
  }

  return (
    <div className={clsx(
      'group border-b border-[var(--border-subtle)] last:border-0 transition-colors',
      expanded ? 'bg-[var(--bg-surface-soft)]' : 'hover:bg-[var(--bg-surface-soft)]/50'
    )}>
      <div 
        className="flex items-center gap-4 py-3 px-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Priority Indicator */}
        <div className={clsx(
          'w-1.5 h-1.5 rounded-full shrink-0',
          `priority-${message.priority || 'low'}`
        )} />

        {/* Sender Avatar/Initial */}
        <div className="w-8 h-8 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center shrink-0 text-xs font-bold text-[var(--text-secondary)] uppercase">
          {message.sender[0]}
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0 grid grid-cols-12 gap-4 items-center">
          {/* Sender Name */}
          <div className="col-span-3 sm:col-span-2 font-medium text-sm text-[var(--text-primary)] truncate">
            {message.sender}
          </div>

          {/* Message Preview */}
          <div className="col-span-7 sm:col-span-8 text-sm text-[var(--text-secondary)] truncate group-hover:text-[var(--text-primary)] transition-colors">
            <span className="font-medium text-[var(--text-primary)] mr-2">
              {message.classification && `[${message.classification}]`}
            </span>
            {message.content}
          </div>

          {/* Time */}
          <div className="col-span-2 text-xs text-[var(--text-muted)] text-right font-mono">
            {formatTime(message.created_at)}
          </div>
        </div>
      </div>

      {/* Expanded Details Panel */}
      {expanded && (
        <div className="px-4 pb-4 pl-[3.25rem]">
          <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] p-4 shadow-sm">
            {/* Full Content */}
            <div className="mb-4">
              <h4 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1">Message Content</h4>
              <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                {message.content}
              </p>
            </div>

            {/* AI Analysis */}
            {message.ai_reasoning && (
              <div className="mb-4 p-3 bg-[var(--bg-surface-soft)] rounded-md border border-[var(--border-subtle)]">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-4 h-4 rounded-full bg-indigo-100 flex items-center justify-center">
                    <div className="w-2 h-2 bg-indigo-500 rounded-full" />
                  </div>
                  <span className="text-xs font-medium text-indigo-600">AI Analysis</span>
                </div>
                <p className="text-xs text-[var(--text-secondary)] italic">
                  "{message.ai_reasoning}"
                </p>
              </div>
            )}

            {/* Controls */}
            <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-subtle)]">
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-muted)]">Category:</span>
                <select
                  value={message.classification || ''}
                  onChange={(e) => onUpdate(message.id, { classification: e.target.value })}
                  className="text-xs bg-transparent border-none p-0 font-medium text-[var(--text-primary)] focus:ring-0 cursor-pointer hover:text-[var(--accent-primary)]"
                >
                  <option value="">Unclassified</option>
                  <option value="work">Work</option>
                  <option value="study">Study</option>
                  <option value="personal">Personal</option>
                  <option value="urgent">Urgent</option>
                  <option value="casual">Casual</option>
                  <option value="spam">Spam</option>
                </select>
              </div>

              <div className="w-px h-3 bg-[var(--border-subtle)]" />

              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--text-muted)]">Action:</span>
                <select
                  value={message.decision || ''}
                  onChange={(e) => onUpdate(message.id, { decision: e.target.value })}
                  className="text-xs bg-transparent border-none p-0 font-medium text-[var(--text-primary)] focus:ring-0 cursor-pointer hover:text-[var(--accent-primary)]"
                >
                  <option value="">No Decision</option>
                  <option value="create">Create Task</option>
                  <option value="ignore">Ignore</option>
                  <option value="review">Review Later</option>
                </select>
              </div>

              <div className="ml-auto">
                <button
                  onClick={() => onDelete(message.id)}
                  className="text-xs text-red-500 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded transition-colors flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Messages() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState(searchParams.get('search') || '')

  const filters = {
    classification: searchParams.get('classification') || '',
    decision: searchParams.get('decision') || '',
    priority: searchParams.get('priority') || '',
  }

  const hasActiveFilters = filters.classification || filters.decision || filters.priority

  const loadMessages = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.classification) params.set('classification', filters.classification)
      if (filters.decision) params.set('decision', filters.decision)
      if (filters.priority) params.set('priority', filters.priority)
      if (searchParams.get('search')) params.set('search', searchParams.get('search')!)
      params.set('limit', '50')

      const res = await fetch(`${API_BASE}/messages?${params}`)
      const json = await res.json()
      if (json.success) {
        setMessages(json.data)
        setTotal(json.pagination?.total || json.data.length)
      }
    } catch (err) {
      console.error('Failed to load messages:', err)
    } finally {
      setLoading(false)
    }
  }, [searchParams, filters.classification, filters.decision, filters.priority])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  const updateFilter = (key: string, value: string) => {
    const newParams = new URLSearchParams(searchParams)
    if (value) {
      newParams.set(key, value)
    } else {
      newParams.delete(key)
    }
    setSearchParams(newParams)
  }

  const clearFilters = () => {
    setSearchParams({})
    setSearch('')
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    updateFilter('search', search)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this message?')) return
    try {
      await fetch(`${API_BASE}/messages/${id}`, { method: 'DELETE' })
      setMessages(messages.filter(m => m.id !== id))
    } catch (err) {
      console.error('Failed to delete:', err)
    }
  }

  const handleUpdate = async (id: string, updates: Partial<Message>) => {
    try {
      const res = await fetch(`${API_BASE}/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      const json = await res.json()
      if (json.success) {
        setMessages(messages.map(m => m.id === id ? { ...m, ...updates } : m))
      }
    } catch (err) {
      console.error('Failed to update:', err)
    }
  }

  return (
    <div className="max-w-5xl mx-auto pb-10">
      {/* Header */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight">Messages</h1>
          <p className="text-[var(--text-secondary)] mt-1">
            {total} messages processed from WhatsApp
          </p>
        </div>
        <button 
          onClick={loadMessages}
          className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-soft)] rounded-lg transition-colors"
          title="Refresh Messages"
        >
          <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Controls Bar */}
      <div className="sticky top-0 bg-[var(--bg-surface)]/95 backdrop-blur-sm py-4 z-10 border-b border-[var(--border-subtle)] mb-0">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <form onSubmit={handleSearch} className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search messages..."
              className="w-full pl-9 pr-4 py-2 bg-[var(--bg-surface-soft)] border border-[var(--border-subtle)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]/20 focus:border-[var(--accent-primary)] transition-all"
            />
          </form>

          {/* Filters */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0">
            <select
              value={filters.classification}
              onChange={(e) => updateFilter('classification', e.target.value)}
              className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-primary)] cursor-pointer hover:bg-[var(--bg-surface-soft)] transition-colors"
            >
              <option value="">All Categories</option>
              <option value="work">Work</option>
              <option value="study">Study</option>
              <option value="personal">Personal</option>
              <option value="urgent">Urgent</option>
              <option value="casual">Casual</option>
            </select>

            <select
              value={filters.priority}
              onChange={(e) => updateFilter('priority', e.target.value)}
              className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-primary)] cursor-pointer hover:bg-[var(--bg-surface-soft)] transition-colors"
            >
              <option value="">All Priority</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            {hasActiveFilters && (
              <button 
                onClick={clearFilters}
                className="p-2 text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                title="Clear filters"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Messages List */}
      <div className="min-h-[400px]">
        {loading ? (
          <div className="flex items-center justify-center h-60">
            <RefreshCw className="w-6 h-6 text-[var(--text-muted)] animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="py-20 text-center soft-card mt-8">
            <MessageSquare className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4 opacity-50" />
            <p className="text-[var(--text-secondary)]">
              {hasActiveFilters 
                ? 'No messages match your filters.'
                : 'No messages yet. Connect WhatsApp to start receiving messages.'
              }
            </p>
            {hasActiveFilters && (
              <button 
                onClick={clearFilters} 
                className="mt-4 text-sm text-[var(--accent-primary)] hover:underline"
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)] border-b border-[var(--border-subtle)]">
            {messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                onDelete={handleDelete}
                onUpdate={handleUpdate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
