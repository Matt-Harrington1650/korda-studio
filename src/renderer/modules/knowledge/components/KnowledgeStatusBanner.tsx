import type { EmbeddingStats } from '../../../../shared/contracts/embedding-provider-contract'
import type { IngestionStatus } from '../../../../shared/ipc-types'

interface KnowledgeStatusBannerProps {
  status: IngestionStatus | null
  onRetry: () => void
  embeddingStats?: EmbeddingStats | null
}

export function KnowledgeStatusBanner({
  status,
  onRetry,
  embeddingStats,
}: KnowledgeStatusBannerProps) {
  const inFlight = status
    ? status.queued + status.extracting + status.chunking + status.contextualizing
    : 0
  const hasFailed = (status?.failed ?? 0) > 0

  if (inFlight > 0 || hasFailed) {
    const progress =
      status && status.total > 0 ? Math.round((status.indexed / status.total) * 100) : 0

    return (
      <div className="flex items-center gap-3 border-b border-border bg-surface-raised px-4 py-2 text-xs text-text-secondary">
        {inFlight > 0 && (
          <>
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            <span>Indexing {inFlight.toLocaleString()} files</span>
            <div className="h-1 max-w-32 flex-1 overflow-hidden rounded-full bg-surface">
              <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>
          </>
        )}
        {hasFailed && <span className="ml-2 text-error">{status!.failed} failed</span>}
        {hasFailed && (
          <button onClick={onRetry} className="ml-auto underline hover:text-text-primary">
            Retry Failed
          </button>
        )}
      </div>
    )
  }

  if (embeddingStats && embeddingStats.total > 0 && !embeddingStats.hasProvider) {
    return (
      <div className="flex items-center gap-2 border-b border-border bg-surface-raised px-4 py-2 text-xs text-text-secondary">
        <span className="font-medium text-text-tertiary">Info</span>
        <span>
          Keyword search only - add an embedding API key in Settings to enable hybrid search
        </span>
      </div>
    )
  }

  if (
    embeddingStats &&
    embeddingStats.total > 0 &&
    !embeddingStats.isReady &&
    embeddingStats.hasProvider
  ) {
    return (
      <div className="flex items-center gap-3 border-b border-border bg-surface-raised px-4 py-2 text-xs text-text-secondary">
        <span className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
        <span>
          Embedding knowledge base{' '}
          <span className="text-text-primary">
            {embeddingStats.embedded.toLocaleString()} / {embeddingStats.total.toLocaleString()}
          </span>{' '}
          chunks ({embeddingStats.percent}%)
        </span>
        <div className="h-1 max-w-32 flex-1 overflow-hidden rounded-full bg-surface">
          <div
            className="h-full bg-blue-400 transition-all"
            style={{ width: `${embeddingStats.percent}%` }}
          />
        </div>
      </div>
    )
  }

  return null
}
