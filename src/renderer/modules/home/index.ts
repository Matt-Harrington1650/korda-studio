import { Home } from 'lucide-react'
import type { ModuleDefinition } from '@shared/types'

export { default as Component } from './HomeModule'

export const definition: ModuleDefinition = {
  id: 'home',
  name: 'Home',
  icon: Home,
  path: '/',
  group: 'work',
  order: 0,
}
