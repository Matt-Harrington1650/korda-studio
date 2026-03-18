import { useState, useEffect, useCallback, useRef } from 'react'
import { STORE_KEYS } from '../../../../shared/electron-store-keys'
import type { IndexStatus } from '../../../../shared/ipc-types'

export function Component() {
  const [rootPath, setRootPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)
  const [status, setStatus] = useState<IndexStatus | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const s = await window.kordaAPI.fileIndexStatus()
      setStatus(s)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    // Load saved path from store on mount
    window.kordaAPI.storeGet(STORE_KEYS.CONNECTIONS).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { fileServerRoot?: string }
          const p = parsed.fileServerRoot ?? ''
          setRootPath(p)
        } catch { /* ignore */ }
      }
    })
    loadStatus()
    const interval = setInterval(loadStatus, 10_000)
    return () => clearInterval(interval)
  }, [loadStatus])

  // Clear saved-ok banner after 4 s
  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    setSavedOk(false)
    try {
      await window.kordaAPI.storeSet(
        STORE_KEYS.CONNECTIONS,
        JSON.stringify({ fileServerRoot: rootPath }),
      )
      await window.kordaAPI.fileIndexReindex()
      await loadStatus()
      setSavedOk(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSavedOk(false), 4_000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleReindex = async () => {
    await window.kordaAPI.fileIndexReindex()
    await loadStatus()
  }

  const fileCount = status?.fileCount ?? 0
  const lastCrawled = status?.lastCrawledMs
    ? new Date(status.lastCrawledMs).toLocaleString()
    : 'Never'

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium text-text-primary">Connections</h2>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-text-secondary uppercase tracking-widest">
          File Server
        </h3>

        <div className="space-y-2">
          <label className="text-sm text-text-primary" htmlFor="root-path">
            Root path
          </label>
          <input
            id="root-path"
            type="text"
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            placeholder="\\SERVER\projects"
            className="w-full px-3 py-2 text-sm bg-surface-raised border border-border rounded
                       text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={!rootPath.trim() || saving}
            className="px-4 py-1.5 text-sm bg-accent text-white rounded
                       hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {savedOk && (
            <span className="text-sm text-green-400">✓ Saved — indexing started</span>
          )}
          {saveError && (
            <span className="text-sm text-red-400">Error: {saveError}</span>
          )}
        </div>

        {/* Status section */}
        <div className="mt-4 p-3 border border-border rounded space-y-1 text-sm text-text-secondary">
          <div className="flex justify-between">
            <span>Files indexed</span>
            <span className="font-mono">{fileCount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span>Last crawl</span>
            <span className="font-mono">{lastCrawled}</span>
          </div>
          {status?.status === 'crawling' && (
            <div className="text-accent">Indexing in progress…</div>
          )}
          {status?.status === 'error' && (
            <div className="text-error">{status.crawlError ?? 'Error'}</div>
          )}
          <div className="pt-2">
            <button
              onClick={handleReindex}
              className="text-xs text-text-secondary hover:text-text-primary underline"
            >
              Re-index
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
