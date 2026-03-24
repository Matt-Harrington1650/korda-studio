import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import type { FileSource } from '../../../../shared/ipc-types'

interface ScopeSelectorProps {
  selectedSourceIds: string[]
  selectedProjects: string[]
  onSourcesChange: (sourceIds: string[]) => void
  onProjectsChange: (projects: string[]) => void
  onApply?: () => void
}

export function ScopeSelector({
  selectedSourceIds,
  selectedProjects,
  onSourcesChange,
  onProjectsChange,
  onApply,
}: ScopeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [sources, setSources] = useState<FileSource[]>([])
  const [projects, setProjects] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    let cancelled = false
    setIsLoading(true)

    void Promise.all([
      window.kordaAPI.fileIndexSourcesList(),
      window.kordaAPI.fileIndexProjectsList(),
    ])
      .then(([nextSources, nextProjects]) => {
        if (cancelled) {
          return
        }
        setSources(nextSources.filter((source) => source.enabled))
        setProjects(nextProjects)
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setSources([])
        setProjects([])
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [isOpen])

  const scopeSummary = useMemo(() => {
    const sourceCount = selectedSourceIds.length
    const projectCount = selectedProjects.length

    if (sourceCount === 0) {
      return 'Plain chat'
    }

    const sourceLabel = `${sourceCount} source${sourceCount === 1 ? '' : 's'}`
    if (projectCount === 0) {
      return sourceLabel
    }

    return `${sourceLabel} • ${projectCount} project${projectCount === 1 ? '' : 's'}`
  }, [selectedProjects.length, selectedSourceIds.length])

  const toggleSelection = (values: string[], nextValue: string) =>
    values.includes(nextValue)
      ? values.filter((value) => value !== nextValue)
      : [...values, nextValue]

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Scope"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
          selectedSourceIds.length > 0
            ? 'border-teal-400/40 bg-teal-400/10 text-teal-100'
            : 'border-border bg-surface-base text-text-secondary hover:text-text-primary'
        }`}
      >
        <span className="relative inline-flex items-center gap-2">
          <Search size={13} />
          <span>Scope</span>
          {selectedSourceIds.length > 0 && (
            <span className="h-2 w-2 rounded-full bg-teal-300" aria-hidden="true" />
          )}
        </span>
        <span className="hidden sm:inline">{scopeSummary}</span>
        <ChevronDown size={12} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 z-20 mb-2 w-80 rounded-2xl border border-border bg-surface-overlay p-4 shadow-xl">
          <div className="space-y-4">
            <section>
              <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-text-secondary">
                Sources
              </div>
              <div className="space-y-2">
                {isLoading ? (
                  <div className="text-sm text-text-secondary">Loading scope…</div>
                ) : sources.length === 0 ? (
                  <div className="text-sm text-text-secondary">No sources available</div>
                ) : (
                  sources.map((source) => (
                    <label
                      key={source.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-text-primary hover:bg-white/5"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSourceIds.includes(source.id)}
                        onChange={() =>
                          onSourcesChange(toggleSelection(selectedSourceIds, source.id))
                        }
                      />
                      <span>{source.displayName}</span>
                    </label>
                  ))
                )}
              </div>
            </section>

            <section>
              <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-text-secondary">
                Projects
              </div>
              <div className="space-y-2">
                {isLoading ? (
                  <div className="text-sm text-text-secondary">Loading projects…</div>
                ) : projects.length === 0 ? (
                  <div className="text-sm text-text-secondary">All projects</div>
                ) : (
                  projects.map((project) => (
                    <label
                      key={project}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-text-primary hover:bg-white/5"
                    >
                      <input
                        type="checkbox"
                        checked={selectedProjects.includes(project)}
                        onChange={() =>
                          onProjectsChange(toggleSelection(selectedProjects, project))
                        }
                      />
                      <span>{project}</span>
                    </label>
                  ))
                )}
              </div>
            </section>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => {
                  onSourcesChange([])
                  onProjectsChange([])
                }}
                className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary"
              >
                Clear scope
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false)
                  onApply?.()
                }}
                className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
              >
                Search these
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
