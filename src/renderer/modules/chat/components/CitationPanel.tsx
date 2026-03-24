import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ChevronDown, ExternalLink, FileSearch } from 'lucide-react'
import type { Citation, EvidenceStatus } from '../../../../shared/ipc-types'

export interface CitationPanelHandle {
  scrollToIndex: (index: number) => void
}

interface CitationPanelProps {
  citations: Citation[]
  evidenceStatus?: EvidenceStatus
  defaultOpen?: boolean
}

function getEvidenceLabel(status: EvidenceStatus | undefined) {
  switch (status) {
    case 'supported':
      return {
        text: 'Fully supported by documents',
        className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
      }
    case 'unsupported':
      return {
        text: 'Not found in documents',
        className: 'border-red-500/30 bg-red-500/10 text-red-200',
      }
    default:
      return {
        text: 'Partially supported',
        className: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
      }
  }
}

function scrollNodeIntoView(node: HTMLDivElement | null) {
  if (node && typeof node.scrollIntoView === 'function') {
    node.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

export const CitationPanel = forwardRef<CitationPanelHandle, CitationPanelProps>(
  function CitationPanel({ citations, evidenceStatus, defaultOpen = false }, forwardedRef) {
    const [isOpen, setIsOpen] = useState(defaultOpen)
    const [pendingScrollIndex, setPendingScrollIndex] = useState<number | null>(null)
    const itemRefs = useRef<Array<HTMLDivElement | null>>([])

    useEffect(() => {
      if (!isOpen || pendingScrollIndex === null) {
        return
      }

      const node = itemRefs.current[pendingScrollIndex]
      if (!node) {
        return
      }

      scrollNodeIntoView(node)
      setPendingScrollIndex(null)
    }, [isOpen, pendingScrollIndex])

    useImperativeHandle(
      forwardedRef,
      () => ({
        scrollToIndex(index) {
          setIsOpen(true)
          const node = itemRefs.current[index]
          if (node) {
            scrollNodeIntoView(node)
            return
          }
          setPendingScrollIndex(index)
        },
      }),
      [],
    )

    const evidence = useMemo(() => getEvidenceLabel(evidenceStatus), [evidenceStatus])

    if (citations.length === 0) {
      return null
    }

    return (
      <div className="mt-4 rounded-2xl border border-border bg-surface-base/80">
        <button
          type="button"
          aria-label={isOpen ? 'Hide sources' : 'Show sources'}
          onClick={() => setIsOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="text-sm font-medium text-text-primary">
            {citations.length} source{citations.length === 1 ? '' : 's'}
          </span>
          <ChevronDown
            size={16}
            className={`text-text-secondary transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {isOpen && (
          <div className="space-y-3 border-t border-border px-4 py-4">
            {citations.map((citation, index) => {
              const meta = [
                citation.sectionTitle,
                citation.pageNumber ? `Page ${citation.pageNumber}` : null,
              ]
                .filter(Boolean)
                .join(' • ')

              return (
                <div
                  key={`${citation.chunkId}-${citation.citationIndex}`}
                  ref={(node) => {
                    itemRefs.current[index] = node
                  }}
                  className="rounded-xl border border-border bg-surface-raised/60 px-3 py-3"
                >
                  <div className="flex items-start gap-2">
                    <span className="rounded border border-border px-1.5 py-0.5 text-[11px] font-semibold text-text-secondary">
                      [{citation.citationIndex}]
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-text-primary">
                        {citation.fileName}
                      </div>
                      {meta && <div className="mt-1 text-xs text-text-secondary">{meta}</div>}
                      <div className="mt-2 text-sm text-text-primary">{citation.excerpt}</div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => void window.kordaAPI.fileIndexOpen(citation.filePath)}
                          className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1.5 text-text-secondary transition-colors hover:text-text-primary"
                        >
                          <ExternalLink size={12} />
                          Open File
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            window.dispatchEvent(
                              new CustomEvent('korda:open-knowledge-citation', {
                                detail: citation,
                              }),
                            )
                          }
                          className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1.5 text-text-secondary transition-colors hover:text-text-primary"
                        >
                          <FileSearch size={12} />
                          View in Knowledge
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}

            <div className={`rounded-xl border px-3 py-2 text-sm ${evidence.className}`}>
              {evidence.text}
            </div>
          </div>
        )}
      </div>
    )
  },
)
