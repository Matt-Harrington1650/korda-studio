import { MessageSquare } from 'lucide-react'
import type { ModuleDefinition } from '@shared/types'
import { router } from '../../router'

export { default as Component } from './ChatModule'

export const definition: ModuleDefinition = {
  id: 'chat',
  name: 'Chat',
  icon: MessageSquare,
  path: '/chat',
  group: 'work',
  order: 2,
  commandPaletteActions: [
    {
      id: 'chat:new',
      label: 'Chat: New Conversation',
      icon: MessageSquare,
      shortcut: 'Ctrl+Shift+A',
      execute: () => {
        void router.navigate('/chat')
      },
    },
  ],
}
