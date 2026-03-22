import type { IngestionStatus } from '../../../../../shared/ipc-types'

interface KnowledgeStatusBannerProps {
  status: IngestionStatus | null
  onRetry: () => void
}

export function KnowledgeStatusBanner({ status, onRetry }: KnowledgeStatusBannerProps) {
  if (!status) {
    return null
  }

  const inFlight = status.queued + status.extracting + status.chunking + status.contextualizing
  const hasFailed = status.failed > 0

  if (inFlight === 0 && !hasFailed) {
    return null
  }

  const progress = status.total > 0 ? Math.round((status.indexed / status.total) * 100) : 0

  return (
    <div className="flex items-center gap-3 border-b border-border bg-surface-raised px-4 py-2 text-xs text-text-secondary">
      {inFlight > 0 && (
        <>
          <span className="text-accent animate-pulse">●</span>
          <span>Indexing {inFlight.toLocaleString()} files</span>
          <div className="h-1 max-w-32 flex-1 overflow-hidden rounded-full bg-surface">
            <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
          </div>
        </>
      )}
      {hasFailed && <span className="ml-2 text-error">{status.failed} failed</span>}
      {hasFailed && (
        <button onClick={onRetry} className="ml-auto underline hover:text-text-primary">
          Retry Failed
        </button>
      )}
    </div>
  )
}
