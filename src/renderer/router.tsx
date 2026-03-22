import { createMemoryRouter } from 'react-router'
import { Shell } from './shared/layout'

export const router = createMemoryRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, lazy: () => import('./modules/home') },
      { path: 'projects', lazy: () => import('./modules/projects') },
      { path: 'chat', lazy: () => import('./modules/chat') },
      { path: 'bookmarks', lazy: () => import('./modules/bookmarks') },
      { path: 'status', lazy: () => import('./modules/system-status') },
      {
        path: 'settings',
        lazy: () => import('./modules/settings'),
        children: [
          { index: true, lazy: () => import('./modules/settings/pages/Appearance') },
          { path: 'profile', lazy: () => import('./modules/settings/pages/Profile') },
          { path: 'connections', lazy: () => import('./modules/settings/pages/Connections') },
          { path: 'ai', lazy: () => import('./modules/settings/pages/AI') },
          { path: 'about', lazy: () => import('./modules/settings/pages/About') },
        ],
      },
    ],
  },
])
