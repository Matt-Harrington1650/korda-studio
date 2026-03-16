import { Link2 } from 'lucide-react'

export function Component() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium text-text-primary">Connections</h2>
      <div className="flex flex-col items-center justify-center py-12 border border-border border-dashed rounded-lg">
        <Link2 size={32} className="text-text-secondary opacity-40 mb-3" />
        <p className="text-sm text-text-secondary">Connection management coming soon</p>
        <p className="text-[11px] text-text-secondary mt-1 opacity-60">
          Configure file servers, AI services, and backend APIs
        </p>
      </div>
    </div>
  )
}
