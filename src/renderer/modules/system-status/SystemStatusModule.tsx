import { useState, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import type { SourceStatus } from '../../../shared/ipc-types'
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
  indexing: 'Indexing…',
}

function sourceStatusesToServiceStatus(statuses: SourceStatus[]): {
  status: ServiceStatus
  detail: string
} {
  if (statuses.length === 0) {
    return { status: 'not-configured', detail: '' }
  }
  const totalFiles = statuses.reduce((n, s) => n + s.fileCount, 0)
  const hasCrawling = statuses.some((s) => s.status === 'crawling')
  const hasError = statuses.some((s) => s.status === 'error')
  const allNotConfigured = statuses.every(
    (s) => s.status === 'not-configured' || s.status === 'disabled',
  )
  if (hasCrawling) {
    return { status: 'indexing', detail: `${totalFiles.toLocaleString()} files…` }
  }
  if (hasError) {
    const errored = statuses.find((s) => s.status === 'error')
    return { status: 'unreachable', detail: errored?.crawlError ?? '' }
  }
  if (allNotConfigured) {
    return { status: 'not-configured', detail: '' }
  }
  return { status: 'connected', detail: `${totalFiles.toLocaleString()} files indexed` }
}

// Skeleton row for loading state — defined at module scope to keep a stable
// component identity across renders (avoids react/no-unstable-nested-components).
function SkeletonRow({ isLast }: { isLast: boolean }) {
  return (
    <tr className={isLast ? '' : 'border-b border-border'}>
      <td className="px-4 py-3">
        <div className="animate-pulse bg-surface-raised h-3 rounded w-20" />
      </td>
      <td className="px-4 py-3">
        <div className="animate-pulse bg-surface-raised h-3 rounded w-16" />
      </td>
      <td className="px-4 py-3">
        <div className="animate-pulse bg-surface-raised h-3 rounded w-24" />
      </td>
      <td className="px-4 py-3">
        <div className="animate-pulse bg-surface-raised h-3 rounded w-14" />
      </td>
    </tr>
  )
}

export default function SystemStatusModule() {
  const [isLoading, setIsLoading] = useState(true)
  const [tick, setTick] = useState(0) // increments every 30s to re-render humanized timestamps
  const [networkStatus, setNetworkStatus] = useState<ServiceStatus>(
    navigator.onLine ? 'connected' : 'unreachable',
  )
  const [fileServerStatus, setFileServerStatus] = useState<ServiceStatus>('not-configured')
  const [fileServerDetail, setFileServerDetail] = useState('')
  const [lastCheckedMs, setLastCheckedMs] = useState(Date.now())

  const refreshFileServer = useCallback(async () => {
    try {
      const s = await window.kordaAPI.fileIndexStatus()
      const { status, detail } = sourceStatusesToServiceStatus(s)
      setFileServerStatus(status)
      setFileServerDetail(detail)
    } catch {
      setFileServerStatus('unreachable')
      setFileServerDetail('')
    }
    setLastCheckedMs(Date.now())
    setIsLoading(false)
  }, [])

  const refresh = useCallback(() => {
    setNetworkStatus(navigator.onLine ? 'connected' : 'unreachable')
    refreshFileServer()
  }, [refreshFileServer])

  useEffect(() => {
    refreshFileServer()
    const handleOnline = () => setNetworkStatus('connected')
    const handleOffline = () => setNetworkStatus('unreachable')
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [refreshFileServer])

  // Tick every 30s to re-render the humanized "last checked" timestamp
  // Does NOT call fileIndexStatus() — only forces a re-render
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const services: Service[] = [
    { name: 'Network', status: networkStatus, detail: '', lastCheckedMs },
    { name: 'File Server', status: fileServerStatus, detail: fileServerDetail, lastCheckedMs },
    { name: 'AI Services', status: 'not-configured', detail: '', lastCheckedMs },
    { name: 'Backend API', status: 'not-configured', detail: '', lastCheckedMs },
  ]

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">System Status</h1>
        <button
          onClick={refresh}
          aria-label="Refresh status"
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary border border-border rounded hover:bg-white/5 transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-surface-raised">
              <th className="text-left px-4 py-2 text-xs font-medium text-text-secondary uppercase tracking-widest">
                Service
              </th>
              <th className="text-left px-4 py-2 text-xs font-medium text-text-secondary uppercase tracking-widest">
                Status
              </th>
              <th className="text-left px-4 py-2 text-xs font-medium text-text-secondary uppercase tracking-widest">
                Detail
              </th>
              <th className="text-left px-4 py-2 text-xs font-medium text-text-secondary uppercase tracking-widest">
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
                <SkeletonRow isLast={true} />
              </>
            ) : (
              services.map((service, i) => (
                <tr
                  key={service.name}
                  className={i < services.length - 1 ? 'border-b border-border' : ''}
                >
                  <td className="px-4 py-3 text-sm text-text-primary">{service.name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${statusColors[service.status].split(' ')[0]}`}
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
                  <td className="px-4 py-3 text-[11px] text-text-secondary font-mono">
                    {/* tick is read here to trigger re-render every 30s */}
                    {tick >= 0 && humanizeAge(Date.now() - service.lastCheckedMs)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-text-secondary opacity-60">
        Additional service monitoring available in future updates
      </p>
    </div>
  )
}
