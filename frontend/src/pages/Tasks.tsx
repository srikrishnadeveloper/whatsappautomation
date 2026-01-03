import { useEffect, useState, useCallback, useRef } from 'react'
import { 
  Check,
  Calendar,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Trash2,
  Clock,
  AlertCircle,
  Info,
  X,
  MessageSquare,
  Filter
} from 'lucide-react'
import clsx from 'clsx'
import { API_BASE } from '../services/api'

interface Task {
  id: string
  title: string
  description?: string
  priority: 'urgent' | 'high' | 'medium' | 'low'
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  category: 'work' | 'study' | 'personal' | 'urgent' | 'other'
  dueDate?: string
  dueTime?: string
  tags?: string[]
  sender?: string
  chatName?: string
  originalMessage?: string
  aiConfidence?: number
  createdAt: string
}

function TaskRow({ 
  task, 
  onToggle, 
  onDelete,
  onShowInfo
}: { 
  task: Task
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  onShowInfo: (task: Task) => void
}) {
  const isCompleted = task.status === 'completed'
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && !isCompleted

  const formatDate = (date: string) => {
    const d = new Date(date)
    // Check if date is valid
    if (isNaN(d.getTime())) return ''
    
    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    
    if (d.toDateString() === today.toDateString()) return 'Today'
    if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
    
    // For dates in different year, show year
    if (d.getFullYear() !== today.getFullYear()) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className={clsx(
      'group flex items-center gap-2 sm:gap-3 py-3 px-2 sm:px-4 rounded-lg transition-all duration-200 w-full max-w-full overflow-hidden relative',
      'hover:bg-[var(--bg-surface-soft)]',
      isCompleted && 'opacity-60'
    )}>
      {/* Checkbox */}
      <button
        onClick={() => onToggle(task.id)}
        className={clsx(
          'w-5 h-5 rounded-full border flex items-center justify-center transition-all duration-200 shrink-0',
          isCompleted 
            ? 'bg-[var(--accent-primary)] border-[var(--accent-primary)] text-white' 
            : 'border-[var(--border-subtle)] hover:border-[var(--accent-primary)] bg-white'
        )}
      >
        {isCompleted && <Check className="w-3 h-3" />}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden">
        <span className={clsx(
          'text-xs sm:text-sm font-medium truncate transition-colors block min-w-0',
          isCompleted ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-primary)]'
        )}>
          {task.title}
        </span>
        
        {/* Priority Badge (only for high/urgent) */}
        {!isCompleted && (task.priority === 'urgent' || task.priority === 'high') && (
          <span className={clsx(
            'text-[10px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0',
            task.priority === 'urgent' 
              ? 'bg-red-50 text-red-600 border border-red-100' 
              : 'bg-orange-50 text-orange-600 border border-orange-100'
          )}>
            {task.priority}
          </span>
        )}
      </div>

      {/* Metadata */}
      <div className="flex items-center gap-1 sm:gap-2 text-xs text-[var(--text-muted)] shrink-0 ml-auto">
        {task.dueDate && (
          <span className={clsx(
            'hidden sm:flex items-center gap-1',
            isOverdue ? 'text-red-500 font-medium' : ''
          )}>
            <Calendar className="w-3 h-3" />
            {formatDate(task.dueDate)}
          </span>
        )}

        {/* Actions */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onShowInfo(task)
          }}
          className="p-1.5 text-[var(--text-muted)] hover:text-[var(--accent-primary)] hover:bg-[var(--accent-light)] rounded-md transition-all"
          title="View details"
        >
          <Info className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete(task.id)
          }}
          className="p-1.5 text-[var(--text-muted)] hover:text-red-500 hover:bg-red-50 rounded-md transition-all"
          title="Delete task"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

function TaskSection({ 
  title, 
  tasks, 
  onToggle, 
  onDelete,
  onShowInfo,
  defaultOpen = true,
  icon: Icon
}: { 
  title: string
  tasks: Task[]
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  onShowInfo: (task: Task) => void
  defaultOpen?: boolean
  icon?: any
}) {
  const [open, setOpen] = useState(defaultOpen)

  if (tasks.length === 0) return null

  return (
    <div className="mb-8 animate-fade-in">
      <button 
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-3 uppercase tracking-wider group transition-colors w-full"
      >
        <div className="p-0.5 rounded hover:bg-[var(--bg-surface-soft)] transition-colors">
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </div>
        {Icon && <Icon className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />}
        <span>{title}</span>
        <span className="text-[var(--text-muted)] font-normal ml-1 bg-[var(--bg-surface-soft)] px-1.5 rounded-full text-[10px]">
          {tasks.length}
        </span>
        <div className="flex-1 h-px bg-[var(--border-subtle)] ml-2 group-hover:bg-[var(--border-color)] transition-colors" />
      </button>
      
      {open && (
        <div className="space-y-0.5">
          {tasks.map((task) => (
            <TaskRow 
              key={task.id}
              task={task} 
              onToggle={onToggle}
              onDelete={onDelete}
              onShowInfo={onShowInfo}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('all')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const sseRef = useRef<EventSource | null>(null)

  const loadTasks = useCallback(async () => {
    try {
      setLoading(true)
      
      // Fetch from action items API (primary source)
      const res = await fetch(`${API_BASE}/actions?limit=100`)
      
      // Handle non-OK responses gracefully
      if (!res.ok) {
        console.warn('Actions API returned:', res.status)
        setTasks([])
        return
      }
      
      const json = await res.json()
      
      if (json.success && json.data) {
        const actionTasks: Task[] = json.data.map((action: any) => ({
          id: action.id,
          title: action.title,
          description: action.description || action.originalMessage,
          priority: action.priority || 'medium',
          status: action.status || 'pending',
          category: action.category || 'other',
          dueDate: action.dueDate,
          dueTime: action.dueTime,
          tags: action.tags || [],
          sender: action.sender,
          chatName: action.chatName,
          originalMessage: action.originalMessage,
          aiConfidence: action.aiConfidence,
          createdAt: action.createdAt
        }))
        setTasks(actionTasks)
      } else {
        // Empty result is valid - no tasks yet
        setTasks([])
      }
    } catch (err) {
      console.error('Failed to load tasks:', err)
      // Don't clear tasks on error - keep showing previous data
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  // Real-time updates via SSE - reload tasks when new messages arrive
  useEffect(() => {
    const eventSource = new EventSource(`${API_BASE}/whatsapp/events`)
    sseRef.current = eventSource

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        // Reload tasks when messages are processed
        if (data.messagesProcessed > 0) {
          loadTasks()
        }
      } catch (err) {}
    }

    eventSource.onerror = () => {
      eventSource.close()
      sseRef.current = null
    }

    return () => {
      eventSource.close()
      sseRef.current = null
    }
  }, [loadTasks])

  // Also poll every 60 seconds for updates (reduced from 30s for efficiency)
  useEffect(() => {
    const interval = setInterval(() => {
      loadTasks()
    }, 60000)
    return () => clearInterval(interval)
  }, [loadTasks])

  const showTaskInfo = (task: Task) => {
    setSelectedTask(task)
  }

  const closeTaskInfo = () => {
    setSelectedTask(null)
  }

  const formatDateTime = (date: string) => {
    const d = new Date(date)
    if (isNaN(d.getTime())) return 'Unknown'
    return d.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const toggleTask = async (id: string) => {
    const task = tasks.find(t => t.id === id)
    if (!task) return

    const newStatus = task.status === 'completed' ? 'pending' : 'completed'
    
    // Optimistic update
    setTasks(tasks.map(t => 
      t.id === id ? { ...t, status: newStatus } : t
    ))

    try {
      // Use action items API
      if (newStatus === 'completed') {
        await fetch(`${API_BASE}/actions/${id}/complete`, { method: 'POST' })
      } else {
        await fetch(`${API_BASE}/actions/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'pending' })
        })
      }
    } catch (err) {
      console.error('Failed to update task:', err)
      // Revert on error
      setTasks(tasks.map(t => 
        t.id === id ? { ...t, status: task.status } : t
      ))
    }
  }

  const deleteTask = async (id: string) => {
    if (!confirm('Delete this task?')) return
    
    const task = tasks.find(t => t.id === id)
    setTasks(tasks.filter(t => t.id !== id))
    
    try {
      await fetch(`${API_BASE}/actions/${id}`, { method: 'DELETE' })
    } catch (err) {
      console.error('Failed to delete task:', err)
      // Revert on error
      if (task) setTasks([...tasks])
    }
  }

  const filteredTasks = tasks.filter(t => {
    if (filter === 'pending') return t.status !== 'completed'
    if (filter === 'completed') return t.status === 'completed'
    return true
  })

  const urgentTasks = filteredTasks.filter(t => t.priority === 'urgent' && t.status !== 'completed')
  const highTasks = filteredTasks.filter(t => t.priority === 'high' && t.status !== 'completed')
  const otherTasks = filteredTasks.filter(t => !['urgent', 'high'].includes(t.priority) && t.status !== 'completed')
  const completedTasks = filteredTasks.filter(t => t.status === 'completed')

  const pendingCount = tasks.filter(t => t.status !== 'completed').length
  const completedCount = tasks.filter(t => t.status === 'completed').length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-6 h-6 text-[var(--text-muted)] animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto pb-10 overflow-hidden w-full relative">
      {/* Task Info Modal */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={closeTaskInfo}>
          <div 
            className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[80vh] overflow-hidden animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-[var(--border-subtle)]">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Task Details</h3>
              <button 
                onClick={closeTaskInfo}
                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-soft)] rounded-md transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* Modal Content */}
            <div className="p-4 space-y-4 overflow-y-auto max-h-[60vh]">
              {/* Task Title */}
              <div>
                <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1">Task</p>
                <p className="text-sm font-medium text-[var(--text-primary)]">{selectedTask.title}</p>
              </div>
              
              {/* Sender Info */}
              {selectedTask.sender && (
                <div className="flex items-center gap-3 p-3 bg-[var(--bg-surface-soft)] rounded-lg">
                  <div className="w-10 h-10 rounded-full bg-[var(--accent-light)] flex items-center justify-center text-sm font-bold text-[var(--accent-primary)] uppercase">
                    {selectedTask.sender[0]}
                  </div>
                  <div>
                    <p className="text-xs text-[var(--text-muted)]">From</p>
                    <p className="text-sm font-medium text-[var(--text-primary)]">{selectedTask.sender}</p>
                    {selectedTask.chatName && selectedTask.chatName !== selectedTask.sender && (
                      <p className="text-xs text-[var(--text-secondary)]">in {selectedTask.chatName}</p>
                    )}
                  </div>
                </div>
              )}
              
              {/* Original Message */}
              {selectedTask.originalMessage && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <MessageSquare className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Original Message</p>
                  </div>
                  <div className="p-3 bg-[var(--bg-surface-soft)] rounded-lg border-l-2 border-[var(--accent-primary)]">
                    <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{selectedTask.originalMessage}</p>
                  </div>
                </div>
              )}
              
              {/* Metadata Grid */}
              <div className="grid grid-cols-2 gap-3">
                {selectedTask.priority && (
                  <div className="p-2.5 bg-[var(--bg-surface-soft)] rounded-lg">
                    <p className="text-[10px] text-[var(--text-muted)] uppercase mb-0.5">Priority</p>
                    <p className={clsx(
                      'text-xs font-medium capitalize',
                      selectedTask.priority === 'urgent' && 'text-red-600',
                      selectedTask.priority === 'high' && 'text-orange-600',
                      selectedTask.priority === 'medium' && 'text-yellow-600',
                      selectedTask.priority === 'low' && 'text-green-600'
                    )}>
                      {selectedTask.priority}
                    </p>
                  </div>
                )}
                
                {selectedTask.category && (
                  <div className="p-2.5 bg-[var(--bg-surface-soft)] rounded-lg">
                    <p className="text-[10px] text-[var(--text-muted)] uppercase mb-0.5">Category</p>
                    <p className="text-xs font-medium text-[var(--text-primary)] capitalize">{selectedTask.category}</p>
                  </div>
                )}
                
                {selectedTask.dueDate && (
                  <div className="p-2.5 bg-[var(--bg-surface-soft)] rounded-lg">
                    <p className="text-[10px] text-[var(--text-muted)] uppercase mb-0.5">Due Date</p>
                    <p className="text-xs font-medium text-[var(--text-primary)]">{formatDateTime(selectedTask.dueDate)}</p>
                  </div>
                )}
                
                {selectedTask.createdAt && (
                  <div className="p-2.5 bg-[var(--bg-surface-soft)] rounded-lg">
                    <p className="text-[10px] text-[var(--text-muted)] uppercase mb-0.5">Created</p>
                    <p className="text-xs font-medium text-[var(--text-primary)]">{formatDateTime(selectedTask.createdAt)}</p>
                  </div>
                )}
              </div>
              
              {/* AI Confidence */}
              {selectedTask.aiConfidence !== undefined && (
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <span>AI Confidence:</span>
                  <div className="flex-1 h-1.5 bg-[var(--bg-surface-soft)] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[var(--accent-primary)] rounded-full"
                      style={{ width: `${selectedTask.aiConfidence * 100}%` }}
                    />
                  </div>
                  <span>{Math.round(selectedTask.aiConfidence * 100)}%</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-end justify-between mb-6 sm:mb-8">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-semibold text-[var(--text-primary)] tracking-tight">Tasks</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">Manage your action items</p>
        </div>
        <button 
          onClick={loadTasks}
          className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-soft)] rounded-lg transition-colors"
          title="Refresh Tasks"
        >
          <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 sticky top-0 bg-[var(--bg-surface)]/95 backdrop-blur-sm py-4 z-10 border-b border-[var(--border-subtle)] w-full max-w-full overflow-hidden">
        {/* Filter Tabs */}
        <div className="flex items-center p-1 bg-[var(--bg-surface-soft)] rounded-lg border border-[var(--border-subtle)] overflow-x-auto max-w-full scrollbar-hide">
          {(['all', 'pending', 'completed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={clsx(
                'px-4 py-1.5 text-xs font-medium rounded-md capitalize transition-all whitespace-nowrap',
                filter === f
                  ? 'bg-white text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              )}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-[var(--text-secondary)]">
          <span className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-orange-400" />
            {pendingCount} Pending
          </span>
          <span className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            {completedCount} Completed
          </span>
        </div>
      </div>

      {/* Task Lists */}
      {tasks.length === 0 ? (
        <div className="py-20 text-center soft-card">
          <div className="w-16 h-16 bg-[var(--bg-surface-soft)] rounded-full flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-[var(--text-muted)]" />
          </div>
          <h3 className="text-lg font-medium text-[var(--text-primary)] mb-1">All caught up</h3>
          <p className="text-sm text-[var(--text-secondary)] max-w-xs mx-auto">
            No tasks found. Tasks extracted from your WhatsApp messages will appear here.
          </p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="py-20 text-center soft-card">
          <Filter className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4 opacity-50" />
          <p className="text-[var(--text-secondary)]">No {filter} tasks to show</p>
          <button 
            onClick={() => setFilter('all')}
            className="mt-4 text-sm text-[var(--accent-primary)] hover:underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <TaskSection
            title="Urgent"
            tasks={urgentTasks}
            onToggle={toggleTask}
            onDelete={deleteTask}
            onShowInfo={showTaskInfo}
            icon={AlertCircle}
          />
          <TaskSection
            title="High Priority"
            tasks={highTasks}
            onToggle={toggleTask}
            onDelete={deleteTask}
            onShowInfo={showTaskInfo}
            icon={AlertCircle}
          />
          <TaskSection
            title="Other Tasks"
            tasks={otherTasks}
            onToggle={toggleTask}
            onDelete={deleteTask}
            onShowInfo={showTaskInfo}
            icon={Clock}
          />
          <TaskSection
            title="Completed"
            tasks={completedTasks}
            onToggle={toggleTask}
            onDelete={deleteTask}
            onShowInfo={showTaskInfo}
            defaultOpen={false}
            icon={Check}
          />
        </div>
      )}
    </div>
  )
}
