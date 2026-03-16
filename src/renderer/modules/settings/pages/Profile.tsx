import { useState, useEffect } from 'react'
import { usePreferencesStore } from '@shared/state/preferencesStore'

export function Component() {
  const { displayName, setDisplayName } = usePreferencesStore()
  const [name, setName] = useState(displayName)

  useEffect(() => {
    setName(displayName)
  }, [displayName])

  const handleSave = () => {
    setDisplayName(name.trim())
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium text-text-primary">Profile</h2>
      <div className="space-y-2">
        <label className="text-sm text-text-secondary">Display Name</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            className="flex-1 px-3 py-2 bg-surface-raised border border-border rounded text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-brand"
          />
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-brand text-white rounded text-sm hover:bg-brand-hover transition-colors"
          >
            Save
          </button>
        </div>
        <p className="text-[11px] text-text-secondary">This name appears in your Home greeting</p>
      </div>
    </div>
  )
}
