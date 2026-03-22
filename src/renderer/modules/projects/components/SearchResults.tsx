import { FileText, Ruler, Calculator, Camera, BookOpen, Briefcase, File } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { FileEntry, FileSource } from '../../../../shared/ipc-types'

interface Props {
  results: FileEntry[]
  onOpenError: (msg: string) => void
  showSourceLabel?: boolean
  sources?: FileSource[]
}

const DOC_TYPE_ICONS: Record<string, LucideIcon> = {
  drawing: Ruler,
  calculation: Calculator,
  spec: BookOpen,
  report: FileText,
  submittal: Briefcase,
  contract: File,
  photo: Camera,
  other: File,
}

const DOC_TYPE_COLORS: Record<string, string> = {
  drawing: 'text-blue-400',
  calculation: 'text-green-400',
  spec: 'text-amber-400',
  report: 'text-purple-400',
  submittal: 'text-orange-400',
  contract: 'text-red-400',
  photo: 'text-pink-400',
  other: 'text-text-secondary',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms
  const days = Math.floor(diff / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

export function SearchResults({ results, onOpenError, showSourceLabel, sources }: Props) {
  if (results.length === 0) return null

  const handleOpen = async (entry: FileEntry) => {
    const err = await window.kordaAPI.fileIndexOpen(entry.path)
    if (err) onOpenError(err)
  }

  return (
    <ul className="divide-y divide-border overflow-auto" role="list">
      {results.map((entry) => {
        const Icon = DOC_TYPE_ICONS[entry.docType ?? 'other'] ?? File
        const iconColor = DOC_TYPE_COLORS[entry.docType ?? 'other'] ?? 'text-text-secondary'
        const breadcrumb = [entry.project, entry.discipline].filter(Boolean).join(' › ')

        return (
          <li
            key={entry.path}
            data-testid="search-result-item"
            onClick={() => handleOpen(entry)}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-raised cursor-pointer group"
            role="listitem"
            aria-label={entry.name}
          >
            {/* Doc-type icon */}
            <Icon size={16} className={`shrink-0 ${iconColor}`} />

            {/* Center: name + breadcrumb + badges */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-text-primary truncate">{entry.name}</div>
              {showSourceLabel &&
                entry.sourceId &&
                (() => {
                  const src = (sources ?? []).find((s) => s.id === entry.sourceId)
                  return src ? (
                    <div className="text-xs text-text-secondary">{src.displayName}</div>
                  ) : null
                })()}
              {breadcrumb && (
                <div className="text-[11px] text-text-secondary truncate">{breadcrumb}</div>
              )}
              <div className="flex items-center gap-1.5 mt-0.5">
                {entry.drawingNumber && (
                  <span className="px-1 py-0.5 text-[10px] bg-blue-900/40 text-blue-300 rounded">
                    {entry.drawingNumber}
                  </span>
                )}
                {entry.revision && (
                  <span className="px-1 py-0.5 text-[10px] bg-surface-raised text-text-secondary rounded border border-border">
                    Rev {entry.revision}
                  </span>
                )}
              </div>
            </div>

            {/* Right: date + size */}
            <div className="shrink-0 text-right">
              <div className="text-[11px] text-text-secondary">
                {formatRelativeTime(entry.modifiedMs)}
              </div>
              <div className="text-[11px] text-text-secondary font-mono">
                {formatBytes(entry.sizeBytes)}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
