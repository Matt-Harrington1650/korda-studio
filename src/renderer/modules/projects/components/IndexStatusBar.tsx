import { useState, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import type { IndexStatus } from '../../../../shared/ipc-types'
import { humanizeAge } from '../../../shared/utils/humanizeAge'

interface Props {
  onReindex: () => void
}

export function IndexStatusBar({ onReindex }: Props) {
  const [status, setStatus] = useState<IndexStatus | null>(null)
  const [liveCount, setLiveCount] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    try {
      const s = await window.kordaAPI.fileIndexStatus()
      setStatus(s)
      if (s.status !== 'crawling') setLiveCount(null)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    refresh()

    // Poll every 30s when idle
    const interval = setInterval(refresh, 30_000)

    // Subscribe to progress events during crawl
    const unsubscribe = window.kordaAPI.onFileIndexProgress((count) => {
      setLiveCount(count)
    })

    return () => {
      clearInterval(interval)
      unsubscribe()
    }
  }, [refresh])

  if (!status || status.status === 'not-configured') return null

  const isCrawling = status.status === 'crawling'
  const isError = status.status === 'error'
  const count = liveCount ?? status.fileCount

  return (
    <div className="flex items-center justify-between px-4 py-1.5 bg-surface-raised border-b border-border text-xs text-text-secondary">
      <div className="flex items-center gap-2">
        {isCrawling && (
          <RefreshCw size={10} className="animate-spin text-accent" />
        )}
        {isCrawling ? (
          <span>Indexing… {count.toLocaleString()} files</span>
        ) : isError ? (
          <span className="text-error">File server unreachable</span>
        ) : (
          <span>
            {count.toLocaleString()} files
            {status.lastCrawledMs
              ? ` · updated ${humanizeAge(Date.now() - status.lastCrawledMs)}`
              : ''}
          </span>
        )}
      </div>
      {isError && (
        <button
          onClick={onReindex}
          className="text-xs underline hover:text-text-primary"
        >
          Retry
        </button>
      )}
    </div>
  )
}
