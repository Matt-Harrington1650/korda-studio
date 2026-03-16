import { Outlet, useLocation } from 'react-router'
import { Suspense } from 'react'
import { TitleBar } from './TitleBar'
import { Sidebar } from './Sidebar'
import { StatusStrip } from './StatusStrip'
import { ModuleErrorBoundary } from './ErrorBoundary'
import { CommandPalette } from './CommandPalette'
import { useCommandPaletteShortcut } from '@shared/hooks/useCommandPalette'
import { ToastContainer } from '@shared/components/Toast'
import { sidebarModules, modules } from '../../moduleRegistry'

function useActiveModuleName(): string {
  const location = useLocation()
  const match = modules.find(
    (m) => location.pathname === m.path || location.pathname.startsWith(m.path + '/'),
  )
  return match?.name ?? 'Module'
}

export function Shell() {
  const moduleName = useActiveModuleName()
  useCommandPaletteShortcut()

  return (
    <div className="h-screen flex flex-col bg-surface-base text-text-primary overflow-hidden">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar modules={sidebarModules} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <main className="flex-1 overflow-auto">
            <ModuleErrorBoundary moduleName={moduleName}>
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-full text-text-secondary">
                    Loading...
                  </div>
                }
              >
                <Outlet />
              </Suspense>
            </ModuleErrorBoundary>
          </main>
          <StatusStrip />
        </div>
      </div>
      <CommandPalette />
      <ToastContainer />
    </div>
  )
}
