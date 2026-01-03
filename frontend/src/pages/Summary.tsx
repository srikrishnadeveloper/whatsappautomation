/**
 * Summary Page - Daily Message Summaries
 * Shows AI-generated summaries of messages grouped by day
 */

import { useEffect, useState, useCallback } from 'react'
import { 
  RefreshCw, 
  Calendar,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Sparkles,
  Users,
  FileText
} from 'lucide-react'
import clsx from 'clsx'
import { API_BASE } from '../services/api'

interface Message {
  id: string
  sender: string
  chat_name: string | null
  content: string
  classification: string | null
  priority: string | null
  created_at: string
}

interface DaySummary {
  date: string
  displayDate: string
  messageCount: number
  topSenders: string[]
  categories: { [key: string]: number }
  highlights: string[]
  messages: Message[]
}

function formatDateHeader(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  
  if (date.toDateString() === today.toDateString()) {
    return 'Today'
  } else if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday'
  } else {
    return date.toLocaleDateString('en-US', { 
      weekday: 'long',
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
    })
  }
}

function generateSummary(messages: Message[]): string[] {
  const highlights: string[] = []
  
  // Count categories
  const categories: { [key: string]: number } = {}
  const senders = new Set<string>()
  let urgentCount = 0
  let taskCount = 0
  
  messages.forEach(msg => {
    senders.add(msg.sender)
    if (msg.classification) {
      categories[msg.classification] = (categories[msg.classification] || 0) + 1
    }
    if (msg.priority === 'urgent' || msg.priority === 'high') {
      urgentCount++
    }
    if (msg.classification === 'work' || msg.classification === 'study') {
      taskCount++
    }
  })
  
  // Generate highlights
  if (messages.length > 0) {
    highlights.push(`${messages.length} messages from ${senders.size} ${senders.size === 1 ? 'person' : 'people'}`)
  }
  
  if (urgentCount > 0) {
    highlights.push(`${urgentCount} high priority ${urgentCount === 1 ? 'message' : 'messages'}`)
  }
  
  const topCategory = Object.entries(categories).sort((a, b) => b[1] - a[1])[0]
  if (topCategory) {
    highlights.push(`Most messages were ${topCategory[0]}`)
  }
  
  return highlights
}

function DaySummaryCard({ 
  summary, 
  isExpanded, 
  onToggle 
}: { 
  summary: DaySummary
  isExpanded: boolean
  onToggle: () => void
}) {
  const categoryColors: { [key: string]: string } = {
    work: 'bg-blue-100 text-blue-700',
    study: 'bg-purple-100 text-purple-700',
    personal: 'bg-green-100 text-green-700',
    urgent: 'bg-red-100 text-red-700',
    casual: 'bg-gray-100 text-gray-600',
    spam: 'bg-yellow-100 text-yellow-700'
  }

  return (
    <div className="soft-card overflow-hidden">
      {/* Summary Header */}
      <div 
        className="flex items-center gap-4 p-4 sm:p-5 cursor-pointer hover:bg-[var(--bg-surface-soft)]/50 transition-colors"
        onClick={onToggle}
      >
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-[var(--accent-light)] flex items-center justify-center shrink-0">
          <Calendar className="w-5 h-5 sm:w-6 sm:h-6 text-[var(--accent-primary)]" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm sm:text-base font-semibold text-[var(--text-primary)]">
              {summary.displayDate}
            </h3>
            <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-surface-soft)] px-2 py-0.5 rounded-full">
              {summary.messageCount} messages
            </span>
          </div>
          
          {/* Quick Stats */}
          <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)]">
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {summary.topSenders.length} contacts
            </span>
            {Object.keys(summary.categories).length > 0 && (
              <span className="flex items-center gap-1">
                <FileText className="w-3 h-3" />
                {Object.keys(summary.categories).length} categories
              </span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-5 h-5 text-[var(--text-muted)]" />
          ) : (
            <ChevronRight className="w-5 h-5 text-[var(--text-muted)]" />
          )}
        </div>
      </div>
      
      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-[var(--border-subtle)]">
          {/* AI Summary Section */}
          <div className="p-4 sm:p-5 bg-gradient-to-br from-[var(--accent-light)]/30 to-transparent">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-[var(--accent-primary)]" />
              <span className="text-xs font-semibold text-[var(--accent-primary)] uppercase tracking-wider">
                Daily Summary
              </span>
            </div>
            
            <ul className="space-y-2">
              {summary.highlights.map((highlight, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)] mt-1.5 shrink-0" />
                  {highlight}
                </li>
              ))}
            </ul>
          </div>
          
          {/* Categories */}
          {Object.keys(summary.categories).length > 0 && (
            <div className="px-4 sm:px-5 py-3 border-t border-[var(--border-subtle)]">
              <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
                Categories
              </p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(summary.categories).map(([cat, count]) => (
                  <span 
                    key={cat}
                    className={clsx(
                      'px-2.5 py-1 rounded-full text-xs font-medium capitalize',
                      categoryColors[cat] || 'bg-gray-100 text-gray-600'
                    )}
                  >
                    {cat}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}
          
          {/* Top Senders */}
          <div className="px-4 sm:px-5 py-3 border-t border-[var(--border-subtle)]">
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
              Active Contacts
            </p>
            <div className="flex flex-wrap gap-2">
              {summary.topSenders.slice(0, 5).map((sender, idx) => (
                <div 
                  key={idx}
                  className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--bg-surface-soft)] rounded-lg"
                >
                  <div className="w-5 h-5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center text-[10px] font-bold text-[var(--text-secondary)] uppercase">
                    {sender[0]}
                  </div>
                  <span className="text-xs text-[var(--text-primary)] font-medium truncate max-w-[100px]">
                    {sender}
                  </span>
                </div>
              ))}
              {summary.topSenders.length > 5 && (
                <span className="px-2.5 py-1.5 text-xs text-[var(--text-muted)]">
                  +{summary.topSenders.length - 5} more
                </span>
              )}
            </div>
          </div>
          
          {/* Message Preview */}
          <div className="px-4 sm:px-5 py-3 border-t border-[var(--border-subtle)]">
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
              Recent Messages
            </p>
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {summary.messages.slice(0, 5).map((msg) => (
                <div 
                  key={msg.id}
                  className="flex items-start gap-2 p-2 rounded-lg bg-[var(--bg-surface-soft)]/50"
                >
                  <div className="w-6 h-6 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center text-[10px] font-bold text-[var(--text-secondary)] uppercase shrink-0 mt-0.5">
                    {msg.sender[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium text-[var(--text-primary)]">{msg.sender}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">
                        {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)] line-clamp-2">{msg.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Summary() {
  const [summaries, setSummaries] = useState<DaySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())

  const loadSummaries = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/messages?limit=500`)
      
      // Handle non-OK responses gracefully
      if (!res.ok) {
        console.warn('Messages API returned:', res.status)
        setSummaries([])
        return
      }
      
      const json = await res.json()
      
      if (json.success && json.data) {
        // Group messages by date
        const messagesByDate: { [key: string]: Message[] } = {}
        
        json.data.forEach((msg: Message) => {
          const dateKey = new Date(msg.created_at).toDateString()
          if (!messagesByDate[dateKey]) {
            messagesByDate[dateKey] = []
          }
          messagesByDate[dateKey].push(msg)
        })
        
        // Create summaries for each day
        const daySummaries: DaySummary[] = Object.entries(messagesByDate)
          .map(([dateKey, messages]) => {
            const sortedMessages = messages.sort(
              (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            )
            
            const senders = [...new Set(messages.map(m => m.sender))]
            const categories: { [key: string]: number } = {}
            messages.forEach(m => {
              if (m.classification) {
                categories[m.classification] = (categories[m.classification] || 0) + 1
              }
            })
            
            return {
              date: dateKey,
              displayDate: formatDateHeader(dateKey),
              messageCount: messages.length,
              topSenders: senders,
              categories,
              highlights: generateSummary(messages),
              messages: sortedMessages
            }
          })
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        
        setSummaries(daySummaries)
        
        // Auto-expand today
        if (daySummaries.length > 0) {
          const today = new Date().toDateString()
          if (daySummaries[0].date === today) {
            setExpandedDays(new Set([today]))
          }
        }
      }
    } catch (err) {
      console.error('Failed to load summaries:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSummaries()
  }, [loadSummaries])

  const toggleDay = (date: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev)
      if (next.has(date)) {
        next.delete(date)
      } else {
        next.add(date)
      }
      return next
    })
  }

  return (
    <div className="max-w-3xl mx-auto pb-10 overflow-hidden w-full relative">
      {/* Header */}
      <div className="flex items-end justify-between mb-6 sm:mb-8">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-semibold text-[var(--text-primary)] tracking-tight">
            Daily Summary
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Messages summarized by day
          </p>
        </div>
        <button 
          onClick={loadSummaries}
          className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-soft)] rounded-lg transition-colors"
          title="Refresh Summaries"
        >
          <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Summaries List */}
      <div className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-60">
            <RefreshCw className="w-6 h-6 text-[var(--text-muted)] animate-spin" />
          </div>
        ) : summaries.length === 0 ? (
          <div className="py-20 text-center soft-card">
            <MessageSquare className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4 opacity-50" />
            <p className="text-[var(--text-secondary)]">
              No messages yet. Connect WhatsApp to start receiving messages.
            </p>
          </div>
        ) : (
          summaries.map((summary) => (
            <DaySummaryCard
              key={summary.date}
              summary={summary}
              isExpanded={expandedDays.has(summary.date)}
              onToggle={() => toggleDay(summary.date)}
            />
          ))
        )}
      </div>
    </div>
  )
}
