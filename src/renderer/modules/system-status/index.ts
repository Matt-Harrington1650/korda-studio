import { Activity } from 'lucide-react'
import type { ModuleDefinition } from '@shared/types'

export { default as Component } from './SystemStatusModule'

export const definition: ModuleDefinition = {
  id: 'system-status',
  name: 'System Status',
  icon: Activity,
  path: '/status',
  group: 'system',
  order: 0,
}
