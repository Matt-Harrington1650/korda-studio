import { Settings } from 'lucide-react'
import type { ModuleDefinition } from '@shared/types'

export { default as Component } from './SettingsModule'

export const definition: ModuleDefinition = {
  id: 'settings',
  name: 'Settings',
  icon: Settings,
  path: '/settings',
  group: 'system',
  order: 1,
}
