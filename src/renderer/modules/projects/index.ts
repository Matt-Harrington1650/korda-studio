import { FolderOpen } from 'lucide-react'
import type { ModuleDefinition } from '@shared/types'
import { router } from '../../router'

export { default as Component } from './ProjectsModule'

export const definition: ModuleDefinition = {
  id: 'projects',
  name: 'Projects',
  icon: FolderOpen,
  path: '/projects',
  group: 'work',
  order: 1,
  commandPaletteActions: [
    {
      id: 'projects:focus-search',
      label: 'Projects: Search Files',
      icon: FolderOpen,
      shortcut: 'Ctrl+Shift+P',
      execute: () => {
        void router.navigate('/projects')
      },
    },
  ],
}
