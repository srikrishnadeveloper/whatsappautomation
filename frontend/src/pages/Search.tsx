/**
 * AI Search Page
 * Matches the existing UI design using CSS variables
 */

import { useState, useCallback } from 'react'
import { 
  Search, 
  Sparkles, 
  MessageSquare, 
  Calendar, 
  User, 
  Clock,
  ChevronRight,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Users,
  ListTodo,
  RefreshCw
} from 'lucide-react'
import clsx from 'clsx'
import { API_BASE } from '../services/api'

interface SearchResult {
  messageId: string
  sender: string
  chatName: string
  content: string
  timestamp: string
  relevanceScore: number
  matchReason: string
}

interface AISearchResponse {
  query: string
  answer: string
  results: SearchResult[]
  summary: string
  suggestedFollowUps?: string[]
}

const QUICK_SEARCHES = [
  { icon: Calendar, label: 'Meetings', query: 'Find all meetings, calls, and appointments' },
  { icon: ListTodo, label: 'Tasks', query: 'Find all tasks, to-do items, and deadlines' },
  { icon: Users, label: 'Important', query: 'Find important or urgent conversations' },
  { icon: Clock, label: 'Reminders', query: 'Find all reminders and things I need to remember' },
]

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [response, setResponse] = useState<AISearchResponse | null>(null)
  const [personSearch, setPersonSearch] = useState('')
  const [personResult, setPersonResult] = useState<any>(null)

  const handleSearch = useCallback(async (searchQuery?: string) => {
    const q = searchQuery || query
    if (!q.trim()) return

    setLoading(true)
    setError(null)
    setResponse(null)
    setPersonResult(null)

    try {
      const res = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q })
      })

      if (!res.ok) {
        throw new Error(`Search failed: ${res.status}`)
      }

      const data = await res.json()
      if (data.success) {
        setResponse(data.data)
      } else {
        setError(data.error || 'Search failed')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to search')
    } finally {
      setLoading(false)
    }
  }, [query])

  const handlePersonSearch = useCallback(async () => {
    if (!personSearch.trim()) return

    setLoading(true)
    setError(null)
    setResponse(null)
    setPersonResult(null)

    try {
      const res = await fetch(`${API_BASE}/search/person/${encodeURIComponent(personSearch)}`)
      
      if (!res.ok) {
        throw new Error(`Search failed: ${res.status}`)
      }

      const data = await res.json()
      if (data.success) {
        setPersonResult(data.data)
      } else {
        setError(data.error || 'Search failed')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to search')
    } finally {
      setLoading(false)
    }
  }, [personSearch])

  const handleQuickSearch = (searchQuery: string) => {
    setQuery(searchQuery)
    handleSearch(searchQuery)
  }

  const handleFollowUp = (followUpQuery: string) => {
    setQuery(followUpQuery)
    handleSearch(followUpQuery)
  }

  const clearResults = () => {
    setResponse(null)
    setPersonResult(null)
    setError(null)
    setQuery('')
    setPersonSearch('')
  }

  const formatTimestamp = (ts: string) => {
    try {
      const date = new Date(ts)
      const now = new Date()
      const diff = now.getTime() - date.getTime()
      const hours = diff / (1000 * 60 * 60)
      
      if (hours < 24) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      } else if (hours < 48) {
        return 'Yesterday'
      } else {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
      }
    } catch {
      return ts
    }
  }

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex-none px-4 sm:px-6 py-3 sm:py-4 border-b border-[var(--border-subtle)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-[var(--accent-light)] flex items-center justify-center">
              <Search className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[var(--accent-primary)]" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-semibold text-[var(--text-primary)]">Search</h1>
              <p className="text-[10px] sm:text-xs text-[var(--text-muted)] hidden sm:block">Find messages, tasks & conversations</p>
            </div>
          </div>
          {(response || personResult) && (
            <button
              onClick={clearResults}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-soft)] rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        <div className="max-w-3xl mx-auto space-y-4 sm:space-y-6">
          
          {/* Main Search */}
          <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] p-3 sm:p-4">
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-3 sm:mb-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Ask anything..."
                  className="w-full pl-10 pr-4 py-2.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] transition-all"
                />
              </div>
              <button
                onClick={() => handleSearch()}
                disabled={loading || !query.trim()}
                className={clsx(
                  'w-full sm:w-auto px-4 py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-all',
                  'bg-[var(--accent-primary)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4" />
                )}
                <span className="sm:inline">Search</span>
              </button>
            </div>

            {/* Quick Searches */}
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              {QUICK_SEARCHES.map((qs, i) => (
                <button
                  key={i}
                  onClick={() => handleQuickSearch(qs.query)}
                  className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-full text-[10px] sm:text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface-soft)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] transition-all"
                >
                  <qs.icon className="w-3 h-3" />
                  {qs.label}
                </button>
              ))}
            </div>
          </div>

          {/* Person Search */}
          <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] p-3 sm:p-4">
            <h3 className="text-xs sm:text-sm font-medium text-[var(--text-primary)] mb-2 sm:mb-3 flex items-center gap-2">
              <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[var(--text-muted)]" />
              Search by Person
            </h3>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <input
                type="text"
                value={personSearch}
                onChange={(e) => setPersonSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePersonSearch()}
                placeholder="Enter person's name..."
                className="flex-1 px-3 sm:px-4 py-2 sm:py-2.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] transition-all"
              />
              <button
                onClick={handlePersonSearch}
                disabled={loading || !personSearch.trim()}
                className="w-full sm:w-auto px-4 py-2 sm:py-2.5 bg-[var(--bg-surface-soft)] border border-[var(--border-subtle)] rounded-lg font-medium text-sm flex items-center justify-center gap-2 hover:bg-[var(--accent-light)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-all text-[var(--text-secondary)]"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Find
              </button>
            </div>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <span className="text-red-700 text-sm">{error}</span>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-3 text-[var(--text-muted)]">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Searching with AI...</span>
              </div>
            </div>
          )}

          {/* Person Search Result */}
          {personResult && !loading && (
            <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
              {/* Person Header */}
              <div className="p-4 border-b border-[var(--border-subtle)] flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[var(--accent-light)] flex items-center justify-center text-[var(--accent-primary)] font-semibold">
                  {personResult.person.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-medium text-[var(--text-primary)]">{personResult.person}</h3>
                  <p className="text-xs text-[var(--text-muted)]">{personResult.messageCount} messages found</p>
                </div>
              </div>
              
              {/* AI Summary */}
              <div className="p-4 bg-[var(--bg-surface-soft)] border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-[var(--accent-primary)]" />
                  <span className="text-xs font-medium text-[var(--accent-primary)]">AI Summary</span>
                </div>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-line">{personResult.summary}</p>
              </div>

              {/* Messages */}
              {personResult.messages && personResult.messages.length > 0 && (
                <div className="p-4">
                  <h4 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-3">Recent Messages</h4>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {personResult.messages.slice(0, 10).map((msg: any, i: number) => (
                      <div key={i} className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--border-subtle)]">
                        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-1">
                          <span className="font-medium text-[var(--text-primary)]">{msg.sender}</span>
                          <span>•</span>
                          <span>{formatTimestamp(msg.timestamp)}</span>
                        </div>
                        <p className="text-sm text-[var(--text-secondary)]">{msg.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* AI Search Results */}
          {response && !loading && (
            <div className="space-y-4">
              {/* AI Answer */}
              <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
                <div className="p-4 bg-[var(--accent-light)] border-b border-[var(--border-subtle)]">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[var(--accent-primary)] flex items-center justify-center flex-shrink-0">
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-sm font-medium text-[var(--accent-primary)] mb-1">AI Answer</h3>
                      <p className="text-sm text-[var(--text-primary)] leading-relaxed">{response.answer}</p>
                    </div>
                  </div>
                </div>

                {/* Summary */}
                {response.summary && (
                  <div className="p-4 border-b border-[var(--border-subtle)]">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-[var(--text-secondary)]">{response.summary}</p>
                    </div>
                  </div>
                )}

                {/* Suggested Follow-ups */}
                {response.suggestedFollowUps && response.suggestedFollowUps.length > 0 && (
                  <div className="p-4">
                    <p className="text-xs font-medium text-[var(--text-muted)] mb-2">Follow-up questions:</p>
                    <div className="flex flex-wrap gap-2">
                      {response.suggestedFollowUps.map((q, i) => (
                        <button
                          key={i}
                          onClick={() => handleFollowUp(q)}
                          className="flex items-center gap-1 px-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-full text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface-soft)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] transition-all"
                        >
                          <ChevronRight className="w-3 h-3" />
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Matching Messages */}
              {response.results.length > 0 && (
                <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
                  <div className="p-4 border-b border-[var(--border-subtle)]">
                    <h3 className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-[var(--text-muted)]" />
                      Matching Messages
                      <span className="text-xs font-normal text-[var(--text-muted)] bg-[var(--bg-surface-soft)] px-2 py-0.5 rounded-full">
                        {response.results.length}
                      </span>
                    </h3>
                  </div>
                  <div className="divide-y divide-[var(--border-subtle)] max-h-[400px] overflow-y-auto">
                    {response.results.map((result, i) => (
                      <div key={i} className="p-4 hover:bg-[var(--bg-surface-soft)] transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-[var(--bg-surface-soft)] border border-[var(--border-subtle)] flex items-center justify-center text-xs font-medium text-[var(--text-secondary)]">
                              {result.sender.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <span className="text-sm font-medium text-[var(--text-primary)]">{result.sender}</span>
                              <span className="text-xs text-[var(--text-muted)] ml-2">in {result.chatName}</span>
                            </div>
                          </div>
                          <span className="text-xs text-[var(--text-muted)] font-mono">{formatTimestamp(result.timestamp)}</span>
                        </div>
                        <p className="text-sm text-[var(--text-secondary)] mb-2">{result.content}</p>
                        <p className="text-xs text-[var(--accent-primary)] flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          {result.matchReason}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {response.results.length === 0 && (
                <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border-subtle)] p-8 text-center">
                  <MessageSquare className="w-10 h-10 text-[var(--text-muted)] mx-auto mb-2" />
                  <p className="text-sm text-[var(--text-muted)]">No matching messages found</p>
                </div>
              )}
            </div>
          )}

          {/* Empty State */}
          {!loading && !response && !personResult && !error && (
            <div className="text-center py-16">
              <div className="w-16 h-16 bg-[var(--bg-surface)] rounded-2xl flex items-center justify-center mx-auto mb-4 border border-[var(--border-subtle)]">
                <Search className="w-8 h-8 text-[var(--text-muted)]" />
              </div>
              <h3 className="text-base font-medium text-[var(--text-primary)] mb-1">Search your messages</h3>
              <p className="text-sm text-[var(--text-muted)] max-w-sm mx-auto">
                Use AI to find meetings, tasks, and conversations. Try the quick search buttons above!
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
