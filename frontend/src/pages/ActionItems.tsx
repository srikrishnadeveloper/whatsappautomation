import { useEffect, useState, useCallback } from 'react'
import { 
  Check,
  Calendar,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Search,
  RefreshCw,
  X
} from 'lucide-react'
import clsx from 'clsx'
import { API_BASE } from '../services/api'

interface ActionItem {
  id: string
  messageId: string | null
  title: string
  description: string | null
  sender: string
  chatName: string | null
  priority: 'urgent' | 'high' | 'medium' | 'low'
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  category: 'work' | 'study' | 'personal' | 'urgent' | 'other'
  dueDate: string | null
  dueTime: string | null
  tags: string[]
  originalMessage: string
  aiConfidence: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

interface ActionStats {
  total: number
  pending: number
  inProgress: number
  completed: number
  byPriority: {
    urgent: number
    high: number
    medium: number
    low: number
  }
  todayDue: number
  overdue: number
}

function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return ''
  
  const today = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  
  if (dueDate === today) return 'Today'
  if (dueDate === tomorrow) return 'Tomorrow'
  return new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false
  return dueDate < new Date().toISOString().split('T')[0]
}

export default function ActionItems() {
  const [items, setItems] = useState<ActionItem[]>([])
  const [stats, setStats] = useState<ActionStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const [showAddModal, setShowAddModal] = useState(false)
  const [newItem, setNewItem] = useState({
    title: '',
    description: '',
    priority: 'medium' as const,
    category: 'other' as const,
    dueDate: ''
  })

  const fetchItems = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filter !== 'all') params.set('status', filter)
      if (priorityFilter !== 'all') params.set('priority', priorityFilter)
      if (search) params.set('search', search)

      const res = await fetch(`${API_BASE}/actions?${params}`)
      const json = await res.json()
      if (json.success) {
        setItems(json.data)
      }
    } catch (err) {
      console.error('Failed to fetch actions:', err)
    } finally {
      setLoading(false)
    }
  }, [filter, priorityFilter, search])

  const fetchStats = async () => {
    try {
      const res = await fetch(`${API_BASE}/actions/stats`)
      const json = await res.json()
      if (json.success) {
        setStats(json.data)
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    }
  }

  useEffect(() => {
    fetchItems()
    fetchStats()
  }, [fetchItems])

  // SSE for real-time updates
  useEffect(() => {
    const eventSource = new EventSource(`${API_BASE}/actions/stream`)

    eventSource.addEventListener('created', (e) => {
      const item = JSON.parse(e.data)
      setItems(prev => [item, ...prev])
      fetchStats()
    })

    eventSource.addEventListener('updated', (e) => {
      const item = JSON.parse(e.data)
      setItems(prev => prev.map(i => i.id === item.id ? item : i))
      fetchStats()
    })

    eventSource.addEventListener('deleted', (e) => {
      const { id } = JSON.parse(e.data)
      setItems(prev => prev.filter(i => i.id !== id))
      fetchStats()
    })

    return () => eventSource.close()
  }, [])

  const toggleComplete = async (item: ActionItem) => {
    try {
      const newStatus = item.status === 'completed' ? 'pending' : 'completed'
      const res = await fetch(`${API_BASE}/actions/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      })
      if (res.ok) {
        const json = await res.json()
        setItems(prev => prev.map(i => i.id === item.id ? json.data : i))
        fetchStats()
      }
    } catch (err) {
      console.error('Failed to update:', err)
    }
  }

  // Removed unused updateStatus function

  const deleteItem = async (id: string) => {
    if (!confirm('Delete this action item?')) return
    try {
      await fetch(`${API_BASE}/actions/${id}`, { method: 'DELETE' })
      setItems(prev => prev.filter(i => i.id !== id))
      fetchStats()
    } catch (err) {
      console.error('Failed to delete:', err)
    }
  }

  const createItem = async () => {
    if (!newItem.title.trim()) return
    try {
      const res = await fetch(`${API_BASE}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newItem)
      })
      if (res.ok) {
        const json = await res.json()
        setItems(prev => [json.data, ...prev])
        setShowAddModal(false)
        setNewItem({ title: '', description: '', priority: 'medium', category: 'other', dueDate: '' })
        fetchStats()
      }
    } catch (err) {
      console.error('Failed to create:', err)
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filteredItems = items

  // Group by priority for better visualization
  const groupedItems = {
    urgent: filteredItems.filter(i => i.priority === 'urgent' && i.status !== 'completed'),
    high: filteredItems.filter(i => i.priority === 'high' && i.status !== 'completed'),
    medium: filteredItems.filter(i => i.priority === 'medium' && i.status !== 'completed'),
    low: filteredItems.filter(i => i.priority === 'low' && i.status !== 'completed'),
    completed: filteredItems.filter(i => i.status === 'completed')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <RefreshCw className="w-5 h-5 text-[var(--text-muted)] animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Action Items</h1>
        <button 
          onClick={() => setShowAddModal(true)}
          className="notion-btn flex items-center gap-1.5 text-sm"
        >
          <Plus className="w-4 h-4" />
          New
        </button>
      </div>
      
      {/* Subtitle stats */}
      {stats && (
        <p className="text-sm text-[var(--text-muted)] mb-6">
          {stats.pending} pending · {stats.inProgress} in progress · {stats.completed} completed
          {stats.overdue > 0 && <span className="text-red-500"> · {stats.overdue} overdue</span>}
        </p>
      )}

      {/* Search & Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="notion-input pl-9 w-full"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as any)}
          className="notion-input text-sm"
        >
          <option value="all">All</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="notion-input text-sm"
        >
          <option value="all">All Priority</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <button 
          onClick={fetchItems}
          className="p-1.5 rounded hover:bg-[var(--bg-hover)] transition-colors"
        >
          <RefreshCw className="w-4 h-4 text-[var(--text-muted)]" />
        </button>
      </div>

      {/* Action Items List */}
      {filteredItems.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-[var(--text-muted)] text-sm">
            No action items found.
          </p>
        </div>
      ) : (
        <div>
          {/* Priority Sections */}
          {(['urgent', 'high', 'medium', 'low'] as const).map(priority => {
            const priorityItems = groupedItems[priority]
            if (priorityItems.length === 0) return null

            return (
              <div key={priority} className="mb-6">
                <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] mb-2 uppercase tracking-wide">
                  <span className={clsx('priority-dot', `priority-${priority}`)} />
                  <span>{priority}</span>
                  <span>({priorityItems.length})</span>
                </div>
                <div className="border-l border-[var(--divider)] ml-1.5 pl-3">
                  {priorityItems.map((item) => (
                    <ActionItemRow
                      key={item.id}
                      item={item}
                      expanded={expandedItems.has(item.id)}
                      onToggleExpand={() => toggleExpand(item.id)}
                      onToggleComplete={() => toggleComplete(item)}
                      onDelete={() => deleteItem(item.id)}
                    />
                  ))}
                </div>
              </div>
            )
          })}

          {/* Completed Section */}
          {filter !== 'pending' && filter !== 'in_progress' && groupedItems.completed.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] mb-2 uppercase tracking-wide">
                <Check className="w-3 h-3" />
                <span>Completed</span>
                <span>({groupedItems.completed.length})</span>
              </div>
              <div className="border-l border-[var(--divider)] ml-1.5 pl-3 opacity-50">
                {groupedItems.completed.slice(0, 5).map((item) => (
                  <ActionItemRow
                    key={item.id}
                    item={item}
                    expanded={expandedItems.has(item.id)}
                    onToggleExpand={() => toggleExpand(item.id)}
                    onToggleComplete={() => toggleComplete(item)}
                    onDelete={() => deleteItem(item.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg shadow-lg w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--divider)]">
              <h3 className="font-medium text-[var(--text-primary)]">New Action Item</h3>
              <button onClick={() => setShowAddModal(false)} className="p-1 hover:bg-[var(--bg-hover)] rounded">
                <X className="w-4 h-4 text-[var(--text-muted)]" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Title</label>
                <input
                  type="text"
                  placeholder="What needs to be done?"
                  value={newItem.title}
                  onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
                  className="notion-input w-full"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Description</label>
                <textarea
                  placeholder="Add more details..."
                  value={newItem.description}
                  onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                  className="notion-input w-full resize-none"
                  rows={3}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Priority</label>
                  <select
                    value={newItem.priority}
                    onChange={(e) => setNewItem({ ...newItem, priority: e.target.value as any })}
                    className="notion-input w-full"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)] mb-1">Category</label>
                  <select
                    value={newItem.category}
                    onChange={(e) => setNewItem({ ...newItem, category: e.target.value as any })}
                    className="notion-input w-full"
                  >
                    <option value="work">Work</option>
                    <option value="study">Study</option>
                    <option value="personal">Personal</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">Due Date</label>
                <input
                  type="date"
                  value={newItem.dueDate}
                  onChange={(e) => setNewItem({ ...newItem, dueDate: e.target.value })}
                  className="notion-input w-full"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--divider)]">
              <button onClick={() => setShowAddModal(false)} className="notion-btn">
                Cancel
              </button>
              <button onClick={createItem} className="notion-btn bg-[var(--text-primary)] text-[var(--bg-primary)]">
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Action Item Row Component - Notion style
function ActionItemRow({
  item,
  expanded,
  onToggleExpand,
  onToggleComplete,
  onDelete
}: {
  item: ActionItem
  expanded: boolean
  onToggleExpand: () => void
  onToggleComplete: () => void
  onDelete: () => void
}) {
  const isCompleted = item.status === 'completed'
  const overdue = isOverdue(item.dueDate) && !isCompleted

  return (
    <div className="notion-row group">
      {/* Checkbox */}
      <button
        onClick={onToggleComplete}
        className="notion-checkbox mr-3"
      >
        {isCompleted && <Check className="w-3 h-3" />}
      </button>

      {/* Title */}
      <span 
        className={clsx(
          'flex-1 text-sm text-[var(--text-primary)] cursor-pointer',
          isCompleted && 'line-through text-[var(--text-muted)]'
        )}
        onClick={onToggleExpand}
      >
        {item.title}
      </span>

      {/* Inline metadata */}
      <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
        {item.dueDate && (
          <span className={clsx(
            'flex items-center gap-1',
            overdue && 'text-red-500'
          )}>
            <Calendar className="w-3 h-3" />
            {formatDueDate(item.dueDate)}
          </span>
        )}
        {item.sender && (
          <span className="hidden sm:block max-w-[100px] truncate">
            {item.sender}
          </span>
        )}
      </div>

      {/* Expand/Delete */}
      <button
        onClick={onToggleExpand}
        className="opacity-0 group-hover:opacity-100 ml-2 p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-opacity"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 p-1 text-[var(--text-muted)] hover:text-red-500 transition-opacity"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="w-full mt-2 pt-2 border-t border-[var(--divider)] text-xs text-[var(--text-muted)]">
          {item.originalMessage && (
            <p className="mb-1">"{item.originalMessage}"</p>
          )}
          {item.sender && (
            <p>From: {item.sender} {item.chatName && item.chatName !== item.sender && `in ${item.chatName}`}</p>
          )}
        </div>
      )}
    </div>
  )
}
