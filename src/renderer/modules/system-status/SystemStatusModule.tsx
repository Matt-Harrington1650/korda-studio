import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { IngestionStatus, SourceStatus } from '../../../shared/ipc-types'
import { DEFAULT_AI_CONFIG, type AIConfig } from '../../../shared/ai-config'
import { STORE_KEYS } from '../../../shared/electron-store-keys'
import { humanizeAge } from '../../shared/utils/humanizeAge'

type ServiceStatus = 'connected' | 'unreachable' | 'not-configured' | 'indexing'

interface Service {
  name: string
  status: ServiceStatus
  detail: string
  lastCheckedMs: number
}

const statusColors: Record<ServiceStatus, string> = {
  connected: 'bg-success text-success',
  unreachable: 'bg-error text-error',
  'not-configured': 'bg-text-secondary text-text-secondary',
  indexing: 'bg-accent text-accent',
}

const statusLabels: Record<ServiceStatus, string> = {
  connected: 'Connected',
  unreachable: 'Unreachable',
  'not-configured': 'Not Configured',
  indexing: 'Indexing...',
}

function sourceStatusesToServiceStatus(statuses: SourceStatus[]): {
  status: ServiceStatus
  detail: string
} {
  if (statuses.length === 0) {
    return { status: 'not-configured', detail: '' }
  }

  const totalFiles = statuses.reduce((count, status) => count + status.fileCount, 0)
  const hasCrawling = statuses.some((status) => status.status === 'crawling')
  const hasError = statuses.some((status) => status.status === 'error')
  const allNotConfigured = statuses.every(
    (status) => status.status === 'not-configured' || status.status === 'disabled',
  )

  if (hasCrawling) {
    return { status: 'indexing', detail: `${totalFiles.toLocaleString()} files...` }
  }

  if (hasError) {
    const errored = statuses.find((status) => status.status === 'error')
    return { status: 'unreachable', detail: errored?.crawlError ?? '' }
  }

  if (allNotConfigured) {
    return { status: 'not-configured', detail: '' }
  }

  return { status: 'connected', detail: `${totalFiles.toLocaleString()} files indexed` }
}

function parseAIConfig(raw: AIConfig | string | null): AIConfig {
  if (!raw) {
    return { ...DEFAULT_AI_CONFIG }
  }

  if (typeof raw === 'string') {
    try {
      return {
        ...DEFAULT_AI_CONFIG,
        ...(JSON.parse(raw) as Partial<AIConfig>),
      }
    } catch {
      return { ...DEFAULT_AI_CONFIG }
    }
  }

  return {
    ...DEFAULT_AI_CONFIG,
    ...raw,
  }
}

function SkeletonRow({ isLast }: { isLast: boolean }) {
  return (
    <tr className={isLast ? '' : 'border-b border-border'}>
      <td className="px-4 py-3">
        <div className="h-3 w-20 animate-pulse rounded bg-surface-raised" />
      </td>
      <td className="px-4 py-3">
        <div className="h-3 w-16 animate-pulse rounded bg-surface-raised" />
      </td>
      <td className="px-4 py-3">
        <div className="h-3 w-24 animate-pulse rounded bg-surface-raised" />
      </td>
      <td className="px-4 py-3">
        <div className="h-3 w-14 animate-pulse rounded bg-surface-raised" />
      </td>
    </tr>
  )
}

interface KnowledgeRowProps {
  label: string
  value: string
  action?: React.ReactNode
}

function KnowledgeRow({ label, value, action }: KnowledgeRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2 last:border-b-0">
      <span className="text-sm text-text-secondary">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-text-primary">{value}</span>
        {action}
      </div>
    </div>
  )
}

export default function SystemStatusModule() {
  const [isLoading, setIsLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const [networkStatus, setNetworkStatus] = useState<ServiceStatus>(
    navigator.onLine ? 'connected' : 'unreachable',
  )
  const [fileServerStatus, setFileServerStatus] = useState<ServiceStatus>('not-configured')
  const [fileServerDetail, setFileServerDetail] = useState('')
  const [knowledgeStatus, setKnowledgeStatus] = useState<IngestionStatus | null>(null)
  const [aiConfig, setAiConfig] = useState<AIConfig>({ ...DEFAULT_AI_CONFIG })
  const [lastCheckedMs, setLastCheckedMs] = useState(Date.now())

  const refresh = useCallback(async () => {
    setNetworkStatus(navigator.onLine ? 'connected' : 'unreachable')

    try {
      const [sourceStatuses, nextKnowledgeStatus, storedAI] = await Promise.all([
        window.kordaAPI.fileIndexStatus(),
        window.kordaAPI.ingestionStatus(),
        window.kordaAPI.storeGet<AIConfig | string>(STORE_KEYS.AI),
      ])

      const { status, detail } = sourceStatusesToServiceStatus(sourceStatuses)
      setFileServerStatus(status)
      setFileServerDetail(detail)
      setKnowledgeStatus(nextKnowledgeStatus)
      setAiConfig(parseAIConfig(storedAI))
    } catch {
      setFileServerStatus('unreachable')
      setFileServerDetail('')
      setKnowledgeStatus(null)
      setAiConfig({ ...DEFAULT_AI_CONFIG })
    }

    setLastCheckedMs(Date.now())
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void refresh()

    const handleOnline = () => setNetworkStatus('connected')
    const handleOffline = () => setNetworkStatus('unreachable')

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [refresh])

  useEffect(() => {
    const interval = setInterval(() => setTick((current) => current + 1), 30_000)
    return () => clearInterval(interval)
  }, [])

  const services: Service[] = [
    { name: 'Network', status: networkStatus, detail: '', lastCheckedMs },
    { name: 'File Server', status: fileServerStatus, detail: fileServerDetail, lastCheckedMs },
    { name: 'AI Services', status: 'not-configured', detail: '', lastCheckedMs },
    { name: 'Backend API', status: 'not-configured', detail: '', lastCheckedMs },
  ]

  const searchMode = aiConfig.voyageApiKey?.trim() ? 'Semantic (voyage-3)' : 'Keyword'
  const contextualEnrichment = aiConfig.contextualEnrichment ? 'ON' : 'OFF'
  const reranking = aiConfig.cohereApiKey?.trim() ? 'ON' : 'OFF'

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">System Status</h1>
        <button
          onClick={() => void refresh()}
          aria-label="Refresh status"
          className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm
                     text-text-secondary transition-colors hover:bg-white/5"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-surface-raised">
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-text-secondary">
                Service
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-text-secondary">
                Status
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-text-secondary">
                Detail
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-text-secondary">
                Last Checked
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <>
                <SkeletonRow isLast={false} />
                <SkeletonRow isLast={false} />
                <SkeletonRow isLast={false} />
                <SkeletonRow isLast />
              </>
            ) : (
              services.map((service, index) => (
                <tr
                  key={service.name}
                  className={index < services.length - 1 ? 'border-b border-border' : ''}
                >
                  <td className="px-4 py-3 text-sm text-text-primary">{service.name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${statusColors[service.status].split(' ')[0]}`}
                      />
                      <span
                        className={statusColors[service.status].split(' ')[1]}
                        {...(service.name === 'File Server'
                          ? { 'data-testid': 'file-server-status' }
                          : {})}
                      >
                        {statusLabels[service.status]}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-text-secondary">{service.detail}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-text-secondary">
                    {tick >= 0 && humanizeAge(Date.now() - service.lastCheckedMs)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <section className="rounded-lg border border-border bg-surface-raised/40 p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium uppercase tracking-widest text-text-secondary">
            Knowledge Base
          </h2>
          {knowledgeStatus && knowledgeStatus.failed > 0 && (
            <a href="/settings/connections" className="text-xs underline hover:text-text-primary">
              View Failed
            </a>
          )}
        </div>

        <div className="space-y-1">
          <KnowledgeRow
            label="Files indexed"
            value={knowledgeStatus ? knowledgeStatus.indexed.toLocaleString() : '--'}
          />
          <KnowledgeRow
            label="Chunks indexed"
            value={knowledgeStatus ? knowledgeStatus.totalChunks.toLocaleString() : '--'}
          />
          <KnowledgeRow
            label="Avg chunks/file"
            value={knowledgeStatus ? knowledgeStatus.avgChunksPerFile.toLocaleString() : '--'}
          />
          <KnowledgeRow
            label="Files failed"
            value={knowledgeStatus ? knowledgeStatus.failed.toLocaleString() : '--'}
          />
          <KnowledgeRow
            label="Files skipped"
            value={knowledgeStatus ? knowledgeStatus.skipped.toLocaleString() : '--'}
          />
          <KnowledgeRow label="Search mode" value={searchMode} />
          <KnowledgeRow label="Contextual enrichment" value={contextualEnrichment} />
          <KnowledgeRow label="Reranking" value={reranking} />
        </div>
      </section>

      <p className="text-[11px] text-text-secondary opacity-60">
        Additional service monitoring available in future updates
      </p>
    </div>
  )
}
