import { Star } from 'lucide-react'
import type { ModuleDefinition } from '@shared/types'

export { default as Component } from './BookmarksModule'

export const definition: ModuleDefinition = {
  id: 'bookmarks',
  name: 'Bookmarks',
  icon: Star,
  path: '/bookmarks',
  group: 'work',
  order: 1,
}
