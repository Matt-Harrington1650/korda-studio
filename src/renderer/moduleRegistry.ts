import { definition as home } from './modules/home'
import { definition as projects } from './modules/projects'
import { definition as bookmarks } from './modules/bookmarks'
import { definition as systemStatus } from './modules/system-status'
import { definition as settings } from './modules/settings'
import type { ModuleDefinition } from '@shared/types'
import type { CommandAction } from '@shared/types'

export const modules: ModuleDefinition[] = [home, projects, bookmarks, systemStatus, settings]

const groupRank: Record<string, number> = { work: 0, system: 1 }

export const sidebarModules = [...modules].sort((a, b) =>
  a.group === b.group ? a.order - b.order : (groupRank[a.group] ?? 99) - (groupRank[b.group] ?? 99),
)

export const allActions: CommandAction[] = modules.flatMap((m) => m.commandPaletteActions ?? [])
