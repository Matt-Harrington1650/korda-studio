import { useState, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'

type ServiceStatus = 'connected' | 'unreachable' | 'not-configured'

interface Service {
  name: string
  status: ServiceStatus
  lastChecked: Date
}

const statusColors: Record<ServiceStatus, string> = {
  connected: 'bg-success text-success',
  unreachable: 'bg-error text-error',
  'not-configured': 'bg-text-secondary text-text-secondary',
}

const statusLabels: Record<ServiceStatus, string> = {
  connected: 'Connected',
  unreachable: 'Unreachable',
  'not-configured': 'Not Configured',
}

export default function SystemStatusModule() {
  const [services, setServices] = useState<Service[]>([
    {
      name: 'Network',
      status: navigator.onLine ? 'connected' : 'unreachable',
      lastChecked: new Date(),
    },
    { name: 'File Server', status: 'not-configured', lastChecked: new Date() },
    { name: 'AI Services', status: 'not-configured', lastChecked: new Date() },
    { name: 'Backend API', status: 'not-configured', lastChecked: new Date() },
  ])

  const refresh = useCallback(() => {
    setServices((prev) =>
      prev.map((s) =>
        s.name === 'Network'
          ? {
              ...s,
              status: navigator.onLine ? 'connected' : 'unreachable',
              lastChecked: new Date(),
            }
          : { ...s, lastChecked: new Date() },
      ),
    )
  }, [])

  useEffect(() => {
    const handleOnline = () => refresh()
    const handleOffline = () => refresh()
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [refresh])

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
                Last Checked
              </th>
            </tr>
          </thead>
          <tbody>
            {services.map((service, i) => (
              <tr
                key={service.name}
                className={i < services.length - 1 ? 'border-b border-border' : ''}
              >
                <td className="px-4 py-3 text-sm text-text-primary">{service.name}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1.5 text-xs`}>
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${statusColors[service.status].split(' ')[0]}`}
                    />
                    <span className={statusColors[service.status].split(' ')[1]}>
                      {statusLabels[service.status]}
                    </span>
                  </span>
                </td>
                <td className="px-4 py-3 text-[11px] text-text-secondary font-mono">
                  {service.lastChecked.toLocaleTimeString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-text-secondary opacity-60">
        Additional service monitoring available in future updates
      </p>
    </div>
  )
}
