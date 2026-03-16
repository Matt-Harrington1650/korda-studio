import { NavLink } from 'react-router'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { usePreferencesStore } from '@shared/state/preferencesStore'
import type { ModuleDefinition } from '@shared/types'

interface SidebarProps {
  modules: ModuleDefinition[]
}

export function Sidebar({ modules }: SidebarProps) {
  const { sidebarCollapsed, toggleSidebar } = usePreferencesStore()

  const groups = modules.reduce(
    (acc, mod) => {
      if (!acc[mod.group]) acc[mod.group] = []
      acc[mod.group].push(mod)
      return acc
    },
    {} as Record<string, ModuleDefinition[]>,
  )

  // Sort groups: work first, then system
  const groupOrder = ['work', 'system']
  const sortedGroups = groupOrder.filter((g) => groups[g])

  return (
    <nav
      aria-label="Module navigation"
      className={`flex flex-col h-full bg-surface-raised border-r border-border transition-all duration-200 ${
        sidebarCollapsed ? 'w-12' : 'w-55'
      }`}
    >
      {/* Project selector placeholder */}
      <div className="px-3 py-2 border-b border-border">
        {!sidebarCollapsed && (
          <div className="text-xs text-text-secondary opacity-40 px-1">No Project</div>
        )}
      </div>

      {/* Module list */}
      <div className="flex-1 overflow-y-auto py-2">
        {sortedGroups.map((group) => (
          <div key={group} className="mb-2">
            {!sidebarCollapsed && (
              <div className="px-4 py-1 text-[10px] font-medium text-text-secondary uppercase tracking-widest">
                {group.toUpperCase()}
              </div>
            )}
            {groups[group]
              .sort((a, b) => a.order - b.order)
              .map((mod) => (
                <NavLink
                  key={mod.id}
                  to={mod.path}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 mx-1 rounded text-sm transition-colors duration-150 ${
                      isActive
                        ? 'bg-brand-muted text-text-primary border-l-2 border-brand'
                        : 'text-text-secondary hover:bg-white/5 border-l-2 border-transparent'
                    }`
                  }
                >
                  <mod.icon size={18} />
                  {!sidebarCollapsed && <span>{mod.name}</span>}
                </NavLink>
              ))}
          </div>
        ))}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className="flex items-center justify-center p-2 border-t border-border text-text-secondary hover:bg-white/5 transition-colors duration-150"
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {sidebarCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
      </button>
    </nav>
  )
}
