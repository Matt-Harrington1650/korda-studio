import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import type { FileSource, IngestionStatus, RetrievalResult } from '../../../shared/ipc-types'
import { ChunkPreview } from './components/ChunkPreview'
import { KnowledgeResults } from './components/KnowledgeResults'
import { KnowledgeStatusBanner } from './components/KnowledgeStatusBanner'

interface EmptyStateProps {
  message: string
  actionHref?: string
  actionLabel?: string
}

function EmptyState({ message, actionHref, actionLabel }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-text-secondary">
      <p className="text-sm">{message}</p>
      {actionHref && actionLabel && (
        <a href={actionHref} className="text-xs underline hover:text-text-primary">
          {actionLabel}
        </a>
      )}
    </div>
  )
}

export function KnowledgeModule() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<RetrievalResult[]>([])
  const [selected, setSelected] = useState<RetrievalResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [sourceId, setSourceId] = useState<string | undefined>(undefined)
  const [project, setProject] = useState<string | undefined>(undefined)
  const [ingestionStatus, setIngestionStatus] = useState<IngestionStatus | null>(null)
  const [sources, setSources] = useState<FileSource[]>([])
  const [projects, setProjects] = useState<string[]>([])
  const [lastQuery, setLastQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchRequestRef = useRef(0)

  const clearPendingSearch = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  const loadSources = useCallback(async () => {
    try {
      const nextSources = await window.kordaAPI.fileIndexSourcesList()
      setSources(nextSources.filter((candidate) => candidate.enabled))
    } catch {
      setSources([])
    }
  }, [])

  const loadProjects = useCallback(async (nextSourceId?: string) => {
    try {
      const nextProjects = await window.kordaAPI.fileIndexProjectsList(nextSourceId)
      setProjects(nextProjects)
    } catch {
      setProjects([])
    }
  }, [])

  const pollStatus = useCallback(
    async (nextSourceId = sourceId) => {
      try {
        const nextStatus = await window.kordaAPI.ingestionStatus(nextSourceId)
        setIngestionStatus(nextStatus)
      } catch {
        setIngestionStatus(null)
      }
    },
    [sourceId],
  )

  const runSearch = useCallback(
    async (nextQuery: string, nextSourceId = sourceId, nextProject = project) => {
      clearPendingSearch()

      const trimmedQuery = nextQuery.trim()
      if (!trimmedQuery) {
        setLastQuery('')
        setResults([])
        setSelected(null)
        setLoading(false)
        return
      }

      const requestId = ++searchRequestRef.current
      setLoading(true)
      setLastQuery(trimmedQuery)

      try {
        const nextResults = await window.kordaAPI.knowledgeSearch({
          query: trimmedQuery,
          sourceId: nextSourceId,
          project: nextProject,
          limit: 20,
        })

        if (searchRequestRef.current !== requestId) {
          return
        }

        setResults(nextResults)
        setSelected(null)
      } catch {
        if (searchRequestRef.current !== requestId) {
          return
        }

        setResults([])
        setSelected(null)
      } finally {
        if (searchRequestRef.current === requestId) {
          setLoading(false)
        }
      }
    },
    [clearPendingSearch, project, sourceId],
  )

  const scheduleSearch = useCallback(
    (nextQuery: string, nextSourceId = sourceId, nextProject = project) => {
      clearPendingSearch()

      if (!nextQuery.trim()) {
        setLastQuery('')
        setResults([])
        setSelected(null)
        setLoading(false)
        return
      }

      debounceRef.current = setTimeout(() => {
        void runSearch(nextQuery, nextSourceId, nextProject)
      }, 300)
    },
    [clearPendingSearch, project, runSearch, sourceId],
  )

  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  useEffect(
    () => () => {
      clearPendingSearch()
    },
    [clearPendingSearch],
  )

  useEffect(() => {
    void loadSources()
    void loadProjects(undefined)
  }, [loadProjects, loadSources])

  useEffect(() => {
    void pollStatus()

    const interval = setInterval(() => {
      void pollStatus()
    }, 10_000)

    const unsubscribe = window.kordaAPI.onIngestionProgress(() => {
      void pollStatus()
    })

    return () => {
      clearInterval(interval)
      unsubscribe()
    }
  }, [pollStatus])

  const handleQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value
    setQuery(nextValue)
    scheduleSearch(nextValue)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()
    void runSearch(query)
  }

  const handleSourceChange = (nextValue: string) => {
    const nextSourceId = nextValue || undefined
    setSourceId(nextSourceId)
    setProject(undefined)
    void loadProjects(nextSourceId)
    void pollStatus(nextSourceId)

    if (query.trim()) {
      void runSearch(query, nextSourceId, undefined)
    }
  }

  const handleProjectChange = (nextValue: string) => {
    const nextProject = nextValue || undefined
    setProject(nextProject)

    if (query.trim()) {
      void runSearch(query, sourceId, nextProject)
    }
  }

  const handleRetry = () => {
    void window.kordaAPI
      .ingestionRetry(sourceId)
      .then(() => pollStatus(sourceId))
      .catch(() => {})
  }

  const showFilters = sources.length > 1 || projects.length > 0

  let content = (
    <KnowledgeResults results={results} onSelect={setSelected} query={lastQuery || undefined} />
  )

  if (loading) {
    content = (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-text-secondary">
        <Loader2 size={14} className="animate-spin" />
        <span>Searching knowledge base...</span>
      </div>
    )
  } else if (!lastQuery && ingestionStatus?.total === 0) {
    content = (
      <EmptyState
        message="No documents indexed yet. Add a file source in Settings -> Connections."
        actionHref="/settings/connections"
        actionLabel="Go to Settings -> Connections"
      />
    )
  } else if (
    !lastQuery &&
    (ingestionStatus?.total ?? 0) > 0 &&
    (ingestionStatus?.indexed ?? 0) === 0
  ) {
    content = (
      <EmptyState message="Files are registered but not yet extracted. Check ingestion status below." />
    )
  }

  return (
    <div className="flex h-full flex-col">
      <KnowledgeStatusBanner status={ingestionStatus} onRetry={handleRetry} />

      <div className="space-y-2 border-b border-border px-4 py-3">
        <div className="relative">
          <input
            ref={searchInputRef}
            role="searchbox"
            type="search"
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            placeholder="Search indexed engineering documents..."
            className="w-full rounded border border-border bg-surface-raised px-3 py-2 pr-8 text-sm
                       text-text-primary placeholder-text-secondary focus:border-accent focus:outline-none"
          />
          {loading && (
            <Loader2
              size={14}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-text-secondary"
            />
          )}
        </div>

        {showFilters && (
          <div className="flex flex-wrap items-center gap-2">
            {sources.length > 1 && (
              <div className="relative">
                <select
                  value={sourceId ?? ''}
                  onChange={(event) => handleSourceChange(event.target.value)}
                  aria-label="Knowledge source"
                  className="appearance-none rounded border border-border bg-surface-raised py-1 pl-2 pr-6
                             text-xs text-text-secondary focus:border-accent focus:outline-none"
                >
                  <option value="">All Sources</option>
                  {sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.displayName}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={10}
                  className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-secondary"
                />
              </div>
            )}

            {projects.length > 0 && (
              <div className="relative">
                <select
                  value={project ?? ''}
                  onChange={(event) => handleProjectChange(event.target.value)}
                  aria-label="Knowledge project"
                  className="appearance-none rounded border border-border bg-surface-raised py-1 pl-2 pr-6
                             text-xs text-text-secondary focus:border-accent focus:outline-none"
                >
                  <option value="">All Projects</option>
                  {projects.map((projectName) => (
                    <option key={projectName} value={projectName}>
                      {projectName}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={10}
                  className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-secondary"
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className={selected ? 'w-3/5 overflow-y-auto' : 'w-full overflow-y-auto'}>
          {content}
        </div>
        {selected && (
          <div className="w-2/5 overflow-hidden border-l border-border">
            <ChunkPreview result={selected} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>
    </div>
  )
}

export default KnowledgeModule
