import { BookOpen } from 'lucide-react'
import type { ModuleDefinition } from '@shared/types'

export { default as Component } from './KnowledgeModule'

export const definition: ModuleDefinition = {
  id: 'knowledge',
  name: 'Knowledge',
  icon: BookOpen,
  path: '/knowledge',
  group: 'work',
  order: 1.5,
}
