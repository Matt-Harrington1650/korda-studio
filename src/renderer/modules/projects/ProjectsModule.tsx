import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, ChevronDown } from 'lucide-react'
import { IndexStatusBar } from './components/IndexStatusBar'
import { SearchResults } from './components/SearchResults'
import { usePreferencesStore } from '../../shared/state/preferencesStore'
import type { FileEntry, SearchParams, FileSource } from '../../../shared/ipc-types'

export default function ProjectsModule() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [sources, setSources] = useState<FileSource[]>([])
  const [selectedSourceId, setSelectedSourceId] = useState<string | undefined>(undefined)
  const [availableProjects, setAvailableProjects] = useState<string[]>([])
  const [hasAnySources, setHasAnySources] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const { pinnedProjects, setPinnedProjects } = usePreferencesStore()

  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    },
    [],
  )

  // Load enabled sources (for scope dropdown) and check if any are configured
  useEffect(() => {
    window.kordaAPI
      .fileIndexSourcesList()
      .then((s) => {
        const enabled = s.filter((x) => x.enabled)
        setSources(enabled)
        setHasAnySources(enabled.length > 0)
      })
      .catch(() => {
        setSources([])
        setHasAnySources(false)
      })
  }, [])

  // Load distinct project names for the project selector dropdown
  // Scoped to selectedSourceId when set; all sources otherwise
  const loadProjects = useCallback((sourceId: string | undefined) => {
    window.kordaAPI
      .fileIndexProjectsList(sourceId)
      .then(setAvailableProjects)
      .catch(() => setAvailableProjects([]))
  }, [])

  useEffect(() => {
    loadProjects(selectedSourceId)
  }, [selectedSourceId, loadProjects])

  const runSearch = useCallback(
    async (q: string, sourceId: string | undefined, projects: string[]) => {
      if (!q.trim()) {
        setResults([])
        return
      }
      setLoading(true)
      try {
        const params: SearchParams = {
          query: q,
          sourceId,
          project: projects.length > 0 ? projects : undefined,
        }
        const res = await window.kordaAPI.fileIndexSearch(params)
        setResults(res)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(val, selectedSourceId, pinnedProjects), 150)
  }

  const handleSourceChange = (sourceId: string) => {
    const next = sourceId === '' ? undefined : sourceId
    setSelectedSourceId(next)
    loadProjects(next)
    if (query.trim()) runSearch(query, next, pinnedProjects)
  }

  const handleProjectToggle = (project: string) => {
    const next = pinnedProjects.includes(project)
      ? pinnedProjects.filter((p) => p !== project)
      : [...pinnedProjects, project]
    setPinnedProjects(next)
    if (query.trim()) runSearch(query, selectedSourceId, next)
  }

  const handleReindex = () => window.kordaAPI.fileIndexReindex()
  const handleOpenError = (msg: string) => console.error('File open error:', msg)

  const isNotConfigured = !hasAnySources
  const showSearchHint = !query.trim() && !isNotConfigured

  return (
    <div className="flex flex-col h-full">
      <IndexStatusBar onReindex={handleReindex} />

      {/* Search controls */}
      <div className="px-4 py-3 border-b border-border space-y-2">
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

        {/* Source scope + project selector row */}
        {sources.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Source scope dropdown */}
            <div className="relative">
              <select
                value={selectedSourceId ?? ''}
                onChange={(e) => handleSourceChange(e.target.value)}
                className="pl-2 pr-6 py-1 text-xs bg-surface-raised border border-border rounded
                           text-text-secondary focus:outline-none focus:border-accent appearance-none"
                aria-label="Source scope"
              >
                <option value="">All Sources</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={10}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-text-secondary"
              />
            </div>

            {/* Project selector — multi-select listbox of distinct project names */}
            {availableProjects.length > 0 && (
              <div className="relative">
                <select
                  multiple
                  value={pinnedProjects}
                  onChange={(e) => {
                    const next = Array.from(e.target.selectedOptions).map((o) => o.value)
                    setPinnedProjects(next)
                    if (query.trim()) runSearch(query, selectedSourceId, next)
                  }}
                  size={Math.min(availableProjects.length, 5)}
                  className="pl-2 pr-2 py-1 text-xs bg-surface-raised border border-border rounded
                             text-text-secondary focus:outline-none focus:border-accent"
                  aria-label="Project filter"
                >
                  {availableProjects.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Pinned project pills — active filters shown inline */}
            {pinnedProjects.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {pinnedProjects.map((p) => (
                  <button
                    key={p}
                    onClick={() => handleProjectToggle(p)}
                    className="px-2 py-0.5 text-xs bg-accent/20 text-accent rounded hover:bg-accent/30"
                  >
                    {p} ×
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isNotConfigured ? (
          <div className="flex flex-col items-center justify-center h-full text-text-secondary gap-2">
            <p className="text-sm">No file sources configured</p>
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
          <SearchResults
            results={results}
            onOpenError={handleOpenError}
            showSourceLabel={!selectedSourceId}
            sources={sources}
          />
        )}
      </div>
    </div>
  )
}
