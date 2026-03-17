import { useEffect, useRef } from 'react'
import { useToastStore } from '@shared/state/toastStore'
import type { IndexStatus } from '../../../shared/ipc-types'

export function useIndexingToasts(): void {
  const addToast = useToastStore((s) => s.addToast)
  const prevStatusRef = useRef<IndexStatus['status'] | null>(null)
  const crawlToastFiredRef = useRef(false)

  useEffect(() => {
    // Establish baseline on mount — prevents false crawling→idle toast on startup
    window.kordaAPI.fileIndexStatus().then((s) => {
      prevStatusRef.current = s.status
    }).catch(() => {})

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
        if (prevStatusRef.current === 'crawling' && current.status === 'idle') {
          addToast({
            title: `Index ready — ${current.fileCount.toLocaleString()} files`,
            type: 'success',
          })
          crawlToastFiredRef.current = false // reset for next crawl
        }
        prevStatusRef.current = current.status
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
