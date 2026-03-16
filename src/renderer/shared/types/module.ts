import type React from 'react'
import type { LucideIcon } from 'lucide-react'

export interface CommandAction {
  id: string
  label: string
  icon?: LucideIcon
  shortcut?: string
  execute: () => void
}

export interface StatusItem {
  id: string
  render: () => React.ReactNode
}

export interface ModuleDefinition {
  id: string
  name: string
  icon: LucideIcon
  path: string
  group: 'work' | 'system'
  order: number
  commandPaletteActions?: CommandAction[]
  statusStripItems?: StatusItem[]
  onActivate?: () => void
  onDeactivate?: () => void
}
