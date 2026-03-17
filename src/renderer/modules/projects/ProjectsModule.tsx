import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { IndexStatusBar } from './components/IndexStatusBar'
import { SearchResults } from './components/SearchResults'
import type { FileEntry, IndexStatus } from '../../../shared/ipc-types'

export default function ProjectsModule() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus search input on mount (e.g. when navigated via Ctrl+Shift+P)
  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Load initial status
  useEffect(() => {
    window.kordaAPI.fileIndexStatus().then(setIndexStatus).catch(() => null)
  }, [])

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      return
    }
    setLoading(true)
    try {
      const res = await window.kordaAPI.fileIndexSearch({ query: q })
      setResults(res)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      runSearch(val)
    }, 150)
  }

  const handleReindex = async () => {
    await window.kordaAPI.fileIndexReindex()
  }

  const handleOpenError = (msg: string) => {
    // Simple console error fallback — useToast integration available if needed
    console.error('File open error:', msg)
  }

  const isNotConfigured = indexStatus?.status === 'not-configured'
  const showSearchHint = !query.trim() && !isNotConfigured

  return (
    <div className="flex flex-col h-full">
      <IndexStatusBar onReindex={handleReindex} />

      {/* Search input */}
      <div className="px-4 py-3 border-b border-border">
        <div className="relative">
          <input
            ref={searchInputRef}
            role="searchbox"
            type="search"
            value={query}
            onChange={handleQueryChange}
            placeholder="Search files by name, drawing number, or path…"
            className="w-full px-3 py-2 pr-8 text-sm bg-surface-raised border border-border rounded
                       text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent"
          />
          {loading && (
            <Loader2
              size={14}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-text-secondary"
            />
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        {isNotConfigured ? (
          <div className="flex flex-col items-center justify-center h-full text-text-secondary gap-2">
            <p className="text-sm">File server not configured</p>
            <a href="/settings/connections" className="text-xs underline hover:text-text-primary">
              Go to Settings → Connections
            </a>
          </div>
        ) : showSearchHint ? (
          <div className="flex items-center justify-center h-full text-text-secondary">
            <p className="text-sm">Search for files by name, drawing number, or path</p>
          </div>
        ) : results.length === 0 && query.trim() ? (
          <div className="flex items-center justify-center h-full text-text-secondary">
            <p className="text-sm">No files matching "{query}"</p>
          </div>
        ) : (
          <SearchResults results={results} onOpenError={handleOpenError} />
        )}
      </div>
    </div>
  )
}
