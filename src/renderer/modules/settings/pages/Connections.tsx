import { useState, useEffect, useCallback, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { Network, Folder, Cloud, RefreshCw, Pencil, Trash2 } from 'lucide-react'
import type { FileSource, FileSourceType, SourceStatus } from '../../../../shared/ipc-types'
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
  const [editingId, setEditingId] = useState<string | null>(null) // null = closed, 'new' = add form
  const [form, setForm] = useState<SourceFormState>(emptyForm())
  const [toast, setToast] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 4_000)
  }

  const loadSources = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([
        window.kordaAPI.fileIndexSourcesList(),
        window.kordaAPI.fileIndexStatus(),
      ])
      setSources(s)
      setStatuses(st)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    loadSources()
    const interval = setInterval(loadSources, 10_000)
    return () => {
      clearInterval(interval)
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [loadSources])

  const statusFor = (id: string) => statuses.find((s) => s.sourceId === id)

  const handleSave = async () => {
    if (!form.path.trim() || !form.displayName.trim()) return
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
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
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
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    }
  }

  const handleReindexAll = () => window.kordaAPI.fileIndexReindex(undefined)

  const startEdit = (source: FileSource) => {
    setForm({ ...source })
    setEditingId(source.id)
  }

  const startAdd = () => {
    setForm(emptyForm())
    setEditingId('new')
  }

  const totalFiles = statuses
    .filter((s) => s.status !== 'disabled')
    .reduce((n, s) => n + s.fileCount, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-text-primary">Connections</h2>
        <button
          onClick={handleReindexAll}
          className="px-3 py-1.5 text-xs bg-surface-raised border border-border rounded
                     text-text-secondary hover:text-text-primary transition-colors"
        >
          Reindex All
        </button>
      </div>

      {/* Summary */}
      <p className="text-xs text-text-secondary">
        {sources.length} source{sources.length !== 1 ? 's' : ''} · {totalFiles.toLocaleString()}{' '}
        files total
      </p>

      {/* Toast */}
      {toast && (
        <div className="px-3 py-2 text-sm bg-surface-raised border border-border rounded text-text-primary">
          {toast}
        </div>
      )}

      {/* Source list */}
      <div className="space-y-2">
        {sources.map((source) => {
          const st = statusFor(source.id)
          const isOffline = st && !st.online
          const isEditing = editingId === source.id

          return (
            <div key={source.id} className="border border-border rounded overflow-hidden">
              <div
                className={`flex items-center gap-3 px-3 py-2 bg-surface-raised ${!source.enabled ? 'opacity-50' : ''}`}
              >
                <span className="text-text-secondary">{TYPE_ICONS[source.type]}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary truncate">
                      {source.displayName}
                    </span>
                    {!source.enabled && (
                      <span className="text-xs px-1.5 py-0.5 bg-surface border border-border rounded text-text-secondary">
                        Disabled
                      </span>
                    )}
                    {isOffline && source.enabled && (
                      <span className="text-xs text-amber-400">● Offline</span>
                    )}
                    {source.enabled && !isOffline && st?.status === 'idle' && (
                      <span className="text-xs text-green-500">● Online</span>
                    )}
                  </div>
                  <div className="text-xs text-text-secondary truncate">{source.path}</div>
                  {st && (
                    <div className="text-xs text-text-secondary">
                      {st.fileCount.toLocaleString()} files
                      {st.lastCrawledMs ? ` · ${new Date(st.lastCrawledMs).toLocaleString()}` : ''}
                    </div>
                  )}
                  {st?.crawlError && (
                    <div className="text-xs text-error truncate">{st.crawlError}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
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

              {/* Inline edit form */}
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

        {/* Add new source */}
        {editingId === 'new' ? (
          <div className="border border-border rounded overflow-hidden">
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
            className="w-full px-3 py-2 text-sm text-text-secondary border border-dashed border-border
                       rounded hover:border-accent hover:text-accent transition-colors"
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
    <div className="px-3 py-3 bg-surface space-y-2 border-t border-border">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-text-secondary">Display Name</label>
          <input
            type="text"
            value={form.displayName}
            onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
            placeholder="Main Server"
            className="w-full mt-1 px-2 py-1 text-sm bg-surface-raised border border-border rounded
                       text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="text-xs text-text-secondary">Type</label>
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as FileSourceType }))}
            className="w-full mt-1 px-2 py-1 text-sm bg-surface-raised border border-border rounded
                       text-text-secondary focus:outline-none focus:border-accent"
          >
            {(Object.keys(TYPE_LABELS) as FileSourceType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
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
          onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
          onBlur={(e) => {
            // Auto-detect type on blur — user can override via the Type dropdown
            const p = e.target.value.trim()
            if (p) setForm((f) => ({ ...f, type: detectSourceType(p) }))
          }}
          placeholder="\\SERVER\share"
          className="w-full mt-1 px-2 py-1 text-sm bg-surface-raised border border-border rounded
                     text-text-primary focus:outline-none focus:border-accent"
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            className="mr-1.5"
          />
          Enabled
        </label>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={saving || !form.path.trim() || !form.displayName.trim()}
          className="px-3 py-1.5 text-xs bg-accent text-white rounded
                     hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save'}
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
