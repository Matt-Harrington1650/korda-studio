import { useEffect, useRef } from 'react'
import { useToastStore } from '@shared/state/toastStore'
// relative import: @shared/* maps to src/renderer/shared/, not src/shared/
import type { SourceStatus } from '../../../shared/ipc-types'

type AggregateStatus = SourceStatus['status'] | null

/** Aggregate multiple SourceStatus entries into a single status for toast logic. */
function aggregateStatus(statuses: SourceStatus[]): AggregateStatus {
  if (statuses.length === 0) return null
  if (statuses.some((s) => s.status === 'crawling')) return 'crawling'
  if (statuses.some((s) => s.status === 'error')) return 'error'
  if (statuses.every((s) => s.status === 'not-configured')) return 'not-configured'
  return 'idle'
}

function totalFileCount(statuses: SourceStatus[]): number {
  return statuses.reduce((n, s) => n + s.fileCount, 0)
}

export function useIndexingToasts(): void {
  const addToast = useToastStore((s) => s.addToast)
  const prevStatusRef = useRef<AggregateStatus>(null)
  const crawlToastFiredRef = useRef(false)

  useEffect(() => {
    // Establish baseline on mount — prevents false crawling→idle toast on startup
    window.kordaAPI
      .fileIndexStatus()
      .then((statuses) => {
        prevStatusRef.current = aggregateStatus(statuses)
      })
      .catch(() => {})

    // Subscribe to progress events — detects crawl start
    const unsubscribe = window.kordaAPI.onFileIndexProgress((count) => {
      if (count > 0 && !crawlToastFiredRef.current) {
        addToast({ title: 'Indexing started', type: 'info' })
        crawlToastFiredRef.current = true
      }
    })

    // Poll every 5s — detects crawl completion
    const intervalId = setInterval(async () => {
      try {
        const current = await window.kordaAPI.fileIndexStatus()
        const currentStatus = aggregateStatus(current)
        if (prevStatusRef.current === 'crawling' && currentStatus === 'idle') {
          addToast({
            title: `Index ready — ${totalFileCount(current).toLocaleString()} files`,
            type: 'success',
          })
          crawlToastFiredRef.current = false // reset for next crawl
        }
        prevStatusRef.current = currentStatus
      } catch {
        // ignore poll errors
      }
    }, 5_000)

    return () => {
      unsubscribe()
      clearInterval(intervalId)
    }
  }, [addToast])
}
