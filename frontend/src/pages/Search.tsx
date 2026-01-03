/**
 * AI Search Page
 * Intelligent search across messages and conversations using AI
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
  ListTodo
} from 'lucide-react'
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
  { icon: Calendar, label: 'Find all meetings', query: 'Find all meetings, calls, and appointments' },
  { icon: ListTodo, label: 'Find all tasks', query: 'Find all tasks, to-do items, and deadlines' },
  { icon: Users, label: 'Important conversations', query: 'Find important or urgent conversations' },
  { icon: Clock, label: 'Recent reminders', query: 'Find all reminders and things I need to remember' },
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

  const formatTimestamp = (ts: string) => {
    try {
      const date = new Date(ts)
      return date.toLocaleString()
    } catch {
      return ts
    }
  }

  return (
    <div className="min-h-screen bg-[#191919] text-white p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold">AI Search</h1>
          </div>
          <p className="text-gray-400">Search through your messages using AI to find meetings, tasks, and conversations</p>
        </div>

        {/* Main Search */}
        <div className="bg-[#252525] rounded-xl p-6 mb-6">
          <div className="flex gap-3 mb-4">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Ask anything... e.g., 'Do I have any meetings with John?' or 'What tasks are due this week?'"
                className="w-full pl-12 pr-4 py-3 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 transition-colors"
              />
            </div>
            <button
              onClick={() => handleSearch()}
              disabled={loading || !query.trim()}
              className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg font-medium flex items-center gap-2 hover:opacity-90 disabled:opacity-50 transition-all"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Sparkles className="w-5 h-5" />
              )}
              Search
            </button>
          </div>

          {/* Quick Searches */}
          <div className="flex flex-wrap gap-2">
            {QUICK_SEARCHES.map((qs, i) => (
              <button
                key={i}
                onClick={() => handleQuickSearch(qs.query)}
                className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded-full text-sm text-gray-300 hover:bg-[#2a2a2a] hover:border-purple-500 transition-all"
              >
                <qs.icon className="w-4 h-4" />
                {qs.label}
              </button>
            ))}
          </div>
        </div>

        {/* Person Search */}
        <div className="bg-[#252525] rounded-xl p-6 mb-6">
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <User className="w-5 h-5 text-blue-400" />
            Search by Person
          </h3>
          <div className="flex gap-3">
            <input
              type="text"
              value={personSearch}
              onChange={(e) => setPersonSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePersonSearch()}
              placeholder="Enter person's name..."
              className="flex-1 px-4 py-3 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
            <button
              onClick={handlePersonSearch}
              disabled={loading || !personSearch.trim()}
              className="px-6 py-3 bg-blue-600 rounded-lg font-medium flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50 transition-all"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
              Find
            </button>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-900/20 border border-red-500/50 rounded-xl p-4 mb-6 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <span className="text-red-400">{error}</span>
          </div>
        )}

        {/* Person Search Result */}
        {personResult && (
          <div className="bg-[#252525] rounded-xl p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-blue-600 rounded-full flex items-center justify-center text-xl font-bold">
                {personResult.person.charAt(0).toUpperCase()}
              </div>
              <div>
                <h3 className="text-lg font-semibold">{personResult.person}</h3>
                <p className="text-gray-400 text-sm">{personResult.messageCount} messages found</p>
              </div>
            </div>
            
            <div className="bg-[#1a1a1a] rounded-lg p-4 mb-4">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                AI Summary
              </h4>
              <p className="text-gray-300 whitespace-pre-line">{personResult.summary}</p>
            </div>

            {personResult.messages && personResult.messages.length > 0 && (
              <div>
                <h4 className="font-medium mb-3">Recent Messages</h4>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {personResult.messages.slice(0, 10).map((msg: any, i: number) => (
                    <div key={i} className="bg-[#1a1a1a] rounded-lg p-3">
                      <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
                        <span className="font-medium text-white">{msg.sender}</span>
                        <span>•</span>
                        <span>{formatTimestamp(msg.timestamp)}</span>
                      </div>
                      <p className="text-gray-300 text-sm">{msg.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* AI Search Results */}
        {response && (
          <div className="space-y-6">
            {/* AI Answer */}
            <div className="bg-gradient-to-br from-purple-900/30 to-pink-900/30 border border-purple-500/30 rounded-xl p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold mb-2">AI Answer</h3>
                  <p className="text-gray-200 leading-relaxed">{response.answer}</p>
                </div>
              </div>

              {/* Summary */}
              {response.summary && (
                <div className="bg-[#1a1a1a]/50 rounded-lg p-4 mt-4">
                  <p className="text-sm text-gray-300">
                    <CheckCircle2 className="w-4 h-4 inline-block mr-2 text-green-400" />
                    {response.summary}
                  </p>
                </div>
              )}

              {/* Suggested Follow-ups */}
              {response.suggestedFollowUps && response.suggestedFollowUps.length > 0 && (
                <div className="mt-4">
                  <p className="text-sm text-gray-400 mb-2">Suggested follow-up questions:</p>
                  <div className="flex flex-wrap gap-2">
                    {response.suggestedFollowUps.map((q, i) => (
                      <button
                        key={i}
                        onClick={() => handleFollowUp(q)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-[#1a1a1a] border border-purple-500/50 rounded-full text-sm text-purple-300 hover:bg-purple-900/30 transition-all"
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
              <div className="bg-[#252525] rounded-xl p-6">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-green-400" />
                  Matching Messages ({response.results.length})
                </h3>
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {response.results.map((result, i) => (
                    <div 
                      key={i} 
                      className="bg-[#1a1a1a] rounded-lg p-4 border-l-4 border-purple-500 hover:bg-[#202020] transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-sm font-medium">
                            {result.sender.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <span className="font-medium">{result.sender}</span>
                            <span className="text-gray-500 text-sm ml-2">in {result.chatName}</span>
                          </div>
                        </div>
                        <span className="text-xs text-gray-500">{formatTimestamp(result.timestamp)}</span>
                      </div>
                      <p className="text-gray-300 mb-2">{result.content}</p>
                      <p className="text-xs text-purple-400">
                        <Sparkles className="w-3 h-3 inline-block mr-1" />
                        {result.matchReason}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {response.results.length === 0 && (
              <div className="bg-[#252525] rounded-xl p-8 text-center">
                <MessageSquare className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400">No matching messages found</p>
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {!loading && !response && !personResult && !error && (
          <div className="text-center py-12">
            <div className="w-20 h-20 bg-[#252525] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Search className="w-10 h-10 text-gray-600" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Search your messages</h3>
            <p className="text-gray-400 max-w-md mx-auto">
              Use AI to find meetings, tasks, conversations, and more. 
              Try asking "Do I have any meetings this week?" or "What did John say about the project?"
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
