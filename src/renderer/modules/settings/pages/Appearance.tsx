import { Moon } from 'lucide-react'

export function Component() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium text-text-primary">Appearance</h2>
      <div className="flex items-center gap-3 p-4 bg-surface-raised border border-border rounded-lg">
        <Moon size={20} className="text-brand" />
        <div>
          <div className="text-sm text-text-primary">Dark Theme</div>
          <div className="text-[11px] text-text-secondary">
            Active — light theme coming in a future update
          </div>
        </div>
      </div>
    </div>
  )
}
