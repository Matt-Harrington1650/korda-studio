import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, AlertTriangle, XCircle } from 'lucide-react'
import type { SourceStatus } from '../../../../shared/ipc-types'
import { humanizeAge } from '../../../shared/utils/humanizeAge'

interface Props {
  onReindex: () => void
}

export function IndexStatusBar({ onReindex }: Props) {
  const [statuses, setStatuses] = useState<SourceStatus[]>([])
  const [liveCount, setLiveCount] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const s = await window.kordaAPI.fileIndexStatus()
      setStatuses(s)
      const anyCrawling = s.some((x) => x.status === 'crawling')
      if (!anyCrawling) setLiveCount(null)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 30_000)
    const unsubscribe = window.kordaAPI.onFileIndexProgress((count) => {
      setLiveCount(count)
      refresh()
    })
    return () => {
      clearInterval(interval)
      unsubscribe()
    }
  }, [refresh])

  const enabled = statuses.filter((s) => s.status !== 'disabled')
  if (enabled.length === 0) return null

  const anyCrawling = enabled.some((s) => s.status === 'crawling') || liveCount !== null
  // Keep sets mutually exclusive to avoid rendering the same source twice
  const offlineSources = enabled.filter((s) => !s.online)
  const errorSources = enabled.filter((s) => s.status === 'error' && s.online)
  const totalFiles = enabled.reduce((sum, s) => sum + s.fileCount, 0)
  const displayCount = liveCount ?? totalFiles
  const oldestCrawl = enabled.reduce(
    (oldest, s) =>
      s.lastCrawledMs && (!oldest || s.lastCrawledMs < oldest) ? s.lastCrawledMs : oldest,
    null as number | null,
  )

  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-surface-raised border-b border-border text-xs text-text-secondary">
      <div className="flex items-center gap-2 flex-wrap">
        {anyCrawling && <RefreshCw size={10} className="animate-spin text-accent" />}
        {anyCrawling ? (
          <span>Indexing… {displayCount.toLocaleString()} files</span>
        ) : errorSources.length > 0 ? (
          errorSources.map((s) => (
            <span
              key={s.sourceId}
              className="text-error flex items-center gap-1"
              title={s.crawlError ?? undefined}
            >
              <XCircle size={10} />
              {s.displayName} unreachable
            </span>
          ))
        ) : (
          <span>
            {displayCount.toLocaleString()} files across {enabled.length} source
            {enabled.length !== 1 ? 's' : ''}
            {oldestCrawl ? ` · updated ${humanizeAge(Date.now() - oldestCrawl)}` : ''}
          </span>
        )}
        {offlineSources.length > 0 &&
          !anyCrawling &&
          offlineSources.map((s) => (
            <span key={s.sourceId} className="text-amber-400 flex items-center gap-1 ml-2">
              <AlertTriangle size={10} />
              {s.displayName} offline
            </span>
          ))}
      </div>
      {(errorSources.length > 0 || offlineSources.length > 0) && (
        <button onClick={onReindex} className="text-xs underline hover:text-text-primary">
          Retry
        </button>
      )}
    </div>
  )
}
