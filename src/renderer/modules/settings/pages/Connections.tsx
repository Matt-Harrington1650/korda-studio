import { useCallback, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { Cloud, Folder, Network, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import type {
  FailedIngestionFile,
  FileSource,
  FileSourceType,
  IngestionStatus,
  SourceStatus,
} from '../../../../shared/ipc-types'
import { detectSourceType } from '../../../../shared/file-sources'

const TYPE_ICONS: Record<FileSourceType, React.ReactNode> = {
  'network-share': <Network size={14} />,
  'mapped-drive': <Network size={14} />,
  local: <Folder size={14} />,
  sharepoint: <Cloud size={14} />,
}

const TYPE_LABELS: Record<FileSourceType, string> = {
  'network-share': 'Network Share',
  'mapped-drive': 'Mapped Drive',
  local: 'Local Folder',
  sharepoint: 'SharePoint',
}

interface SourceFormState {
  id: string
  displayName: string
  path: string
  type: FileSourceType
  enabled: boolean
}

const emptyForm = (): SourceFormState => ({
  id: uuidv4(),
  displayName: '',
  path: '',
  type: 'local',
  enabled: true,
})

export function Component() {
  const [sources, setSources] = useState<FileSource[]>([])
  const [statuses, setStatuses] = useState<SourceStatus[]>([])
  const [ingestionStatuses, setIngestionStatuses] = useState<Record<string, IngestionStatus>>({})
  const [failedFilesBySource, setFailedFilesBySource] = useState<
    Record<string, FailedIngestionFile[]>
  >({})
  const [expandedFailedSources, setExpandedFailedSources] = useState<Record<string, boolean>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<SourceFormState>(emptyForm())
  const [toast, setToast] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = (message: string) => {
    setToast(message)
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
    }
    toastTimerRef.current = setTimeout(() => setToast(null), 4_000)
  }

  const loadSources = useCallback(async () => {
    try {
      const [nextSources, nextStatuses] = await Promise.all([
        window.kordaAPI.fileIndexSourcesList(),
        window.kordaAPI.fileIndexStatus(),
      ])

      const ingestionEntries = await Promise.all(
        nextSources.map(async (source) => {
          try {
            const ingestionStatus = await window.kordaAPI.ingestionStatus(source.id)
            return [source.id, ingestionStatus] as const
          } catch {
            return null
          }
        }),
      )

      setSources(nextSources)
      setStatuses(nextStatuses)
      setIngestionStatuses(
        Object.fromEntries(
          ingestionEntries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
        ),
      )
    } catch {
      // Ignore read failures so the page can keep rendering partial state.
    }
  }, [])

  useEffect(() => {
    void loadSources()
    const interval = setInterval(() => {
      void loadSources()
    }, 10_000)

    return () => {
      clearInterval(interval)
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current)
      }
    }
  }, [loadSources])

  const statusFor = (id: string) => statuses.find((status) => status.sourceId === id)
  const ingestionStatusFor = (id: string) => ingestionStatuses[id]

  const loadFailedFiles = useCallback(async (sourceId: string) => {
    try {
      const failedFiles = await window.kordaAPI.ingestionFailedFiles(sourceId)
      setFailedFilesBySource((current) => ({
        ...current,
        [sourceId]: failedFiles,
      }))
    } catch {
      setFailedFilesBySource((current) => ({
        ...current,
        [sourceId]: [],
      }))
    }
  }, [])

  const handleSave = async () => {
    if (!form.path.trim() || !form.displayName.trim()) {
      return
    }

    setSaving(true)

    try {
      const source: FileSource = {
        id: form.id,
        displayName: form.displayName.trim(),
        path: form.path.trim(),
        type: form.type,
        enabled: form.enabled,
      }
      await window.kordaAPI.fileIndexSourceSave(source)
      await loadSources()
      setEditingId(null)
      showToast('Source saved')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (sourceId: string) => {
    try {
      const result = await window.kordaAPI.fileIndexSourceDelete(sourceId)
      if (typeof result === 'string') {
        showToast(result)
        return
      }

      await loadSources()
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error))
    }
  }

  const handleReindexAll = () => window.kordaAPI.fileIndexReindex(undefined)

  const handleRetryFailed = async (sourceId: string) => {
    try {
      await window.kordaAPI.ingestionRetry(sourceId)
      await loadSources()
      if (expandedFailedSources[sourceId]) {
        await loadFailedFiles(sourceId)
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error))
    }
  }

  const toggleFailedFiles = async (sourceId: string) => {
    const nextExpanded = !expandedFailedSources[sourceId]
    setExpandedFailedSources((current) => ({
      ...current,
      [sourceId]: nextExpanded,
    }))

    if (nextExpanded) {
      await loadFailedFiles(sourceId)
    }
  }

  const startEdit = (source: FileSource) => {
    setForm({ ...source })
    setEditingId(source.id)
  }

  const startAdd = () => {
    setForm(emptyForm())
    setEditingId('new')
  }

  const totalFiles = statuses
    .filter((status) => status.status !== 'disabled')
    .reduce((count, status) => count + status.fileCount, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-text-primary">Connections</h2>
        <button
          onClick={handleReindexAll}
          className="rounded border border-border bg-surface-raised px-3 py-1.5 text-xs
                     text-text-secondary transition-colors hover:text-text-primary"
        >
          Reindex All
        </button>
      </div>

      <p className="text-xs text-text-secondary">
        {sources.length} source{sources.length !== 1 ? 's' : ''} · {totalFiles.toLocaleString()}{' '}
        files total
      </p>

      {toast && (
        <div className="rounded border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary">
          {toast}
        </div>
      )}

      <div className="space-y-2">
        {sources.map((source) => {
          const status = statusFor(source.id)
          const ingestion = ingestionStatusFor(source.id)
          const pendingCount =
            (ingestion?.queued ?? 0) +
            (ingestion?.extracting ?? 0) +
            (ingestion?.chunking ?? 0) +
            (ingestion?.contextualizing ?? 0)
          const failedFiles = failedFilesBySource[source.id] ?? []
          const isFailedExpanded = expandedFailedSources[source.id] ?? false
          const isOffline = status?.online === false
          const isEditing = editingId === source.id

          return (
            <div key={source.id} className="overflow-hidden rounded border border-border">
              <div
                className={`flex items-center gap-3 bg-surface-raised px-3 py-2 ${!source.enabled ? 'opacity-50' : ''}`}
              >
                <span className="text-text-secondary">{TYPE_ICONS[source.type]}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-text-primary">
                      {source.displayName}
                    </span>
                    {!source.enabled && (
                      <span className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-text-secondary">
                        Disabled
                      </span>
                    )}
                    {isOffline && source.enabled && (
                      <span className="text-xs text-amber-400">Offline</span>
                    )}
                    {source.enabled && !isOffline && status?.status === 'idle' && (
                      <span className="text-xs text-green-500">Online</span>
                    )}
                  </div>
                  <div className="truncate text-xs text-text-secondary">{source.path}</div>
                  {status && (
                    <div className="text-xs text-text-secondary">
                      {status.fileCount.toLocaleString()} files
                      {status.lastCrawledMs
                        ? ` · ${new Date(status.lastCrawledMs).toLocaleString()}`
                        : ''}
                    </div>
                  )}
                  {ingestion && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                      <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                        {ingestion.indexed.toLocaleString()} indexed
                      </span>
                      {ingestion.failed > 0 && (
                        <button
                          onClick={() => void toggleFailedFiles(source.id)}
                          className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-red-200 hover:bg-red-500/20"
                        >
                          {ingestion.failed} failed
                        </button>
                      )}
                      {pendingCount > 0 && (
                        <span className="rounded-full border border-border bg-surface px-2 py-0.5">
                          {pendingCount.toLocaleString()} queued
                        </span>
                      )}
                      <button
                        onClick={() => void handleRetryFailed(source.id)}
                        className="underline hover:text-text-primary"
                      >
                        Retry Failed
                      </button>
                    </div>
                  )}
                  {status?.crawlError && (
                    <div className="truncate text-xs text-error">{status.crawlError}</div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => window.kordaAPI.fileIndexReindex(source.id)}
                    title="Reindex"
                    aria-label="reindex"
                    className="p-1 text-text-secondary hover:text-text-primary"
                  >
                    <RefreshCw size={12} />
                  </button>
                  <button
                    onClick={() => startEdit(source)}
                    title="Edit"
                    aria-label="edit"
                    className="p-1 text-text-secondary hover:text-text-primary"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => handleDelete(source.id)}
                    title="Delete"
                    aria-label="delete"
                    className="p-1 text-text-secondary hover:text-error"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {isFailedExpanded && failedFiles.length > 0 && (
                <div className="space-y-2 border-t border-border bg-surface px-3 py-3">
                  {failedFiles.map((failedFile) => (
                    <div
                      key={failedFile.fileId}
                      className="rounded border border-border bg-surface-raised px-3 py-2"
                    >
                      <div className="text-sm font-medium text-text-primary">{failedFile.name}</div>
                      <div className="truncate text-xs text-text-secondary">{failedFile.path}</div>
                      {failedFile.error && (
                        <div className="text-xs text-error">{failedFile.error}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {isEditing && (
                <SourceForm
                  form={form}
                  setForm={setForm}
                  onSave={handleSave}
                  onCancel={() => setEditingId(null)}
                  saving={saving}
                />
              )}
            </div>
          )
        })}

        {editingId === 'new' ? (
          <div className="overflow-hidden rounded border border-border">
            <SourceForm
              form={form}
              setForm={setForm}
              onSave={handleSave}
              onCancel={() => setEditingId(null)}
              saving={saving}
            />
          </div>
        ) : (
          <button
            onClick={startAdd}
            className="w-full rounded border border-dashed border-border px-3 py-2 text-sm
                       text-text-secondary transition-colors hover:border-accent hover:text-accent"
          >
            + Add Source
          </button>
        )}
      </div>
    </div>
  )
}

interface SourceFormProps {
  form: SourceFormState
  setForm: React.Dispatch<React.SetStateAction<SourceFormState>>
  onSave: () => void
  onCancel: () => void
  saving: boolean
}

function SourceForm({ form, setForm, onSave, onCancel, saving }: SourceFormProps) {
  return (
    <div className="space-y-2 border-t border-border bg-surface px-3 py-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-text-secondary">Display Name</label>
          <input
            type="text"
            value={form.displayName}
            onChange={(event) =>
              setForm((current) => ({ ...current, displayName: event.target.value }))
            }
            placeholder="Main Server"
            className="mt-1 w-full rounded border border-border bg-surface-raised px-2 py-1 text-sm
                       text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
        <div>
          <label className="text-xs text-text-secondary">Type</label>
          <select
            value={form.type}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                type: event.target.value as FileSourceType,
              }))
            }
            className="mt-1 w-full rounded border border-border bg-surface-raised px-2 py-1 text-sm
                       text-text-secondary focus:border-accent focus:outline-none"
          >
            {(Object.keys(TYPE_LABELS) as FileSourceType[]).map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs text-text-secondary">Path</label>
        <input
          type="text"
          value={form.path}
          onChange={(event) => setForm((current) => ({ ...current, path: event.target.value }))}
          onBlur={(event) => {
            const nextPath = event.target.value.trim()
            if (nextPath) {
              setForm((current) => ({
                ...current,
                type: detectSourceType(nextPath),
              }))
            }
          }}
          placeholder="\\\\SERVER\\share"
          className="mt-1 w-full rounded border border-border bg-surface-raised px-2 py-1 text-sm
                     text-text-primary focus:border-accent focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                enabled: event.target.checked,
              }))
            }
            className="mr-1.5"
          />
          Enabled
        </label>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={saving || !form.path.trim() || !form.displayName.trim()}
          className="rounded bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent/80
                     disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
