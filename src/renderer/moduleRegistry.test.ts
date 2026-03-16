import { modules, sidebarModules, allActions } from './moduleRegistry'

describe('moduleRegistry', () => {
  it('has no duplicate module IDs', () => {
    const ids = modules.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('has no duplicate paths', () => {
    const paths = modules.map((m) => m.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('contains all four seed modules', () => {
    const ids = modules.map((m) => m.id)
    expect(ids).toContain('home')
    expect(ids).toContain('bookmarks')
    expect(ids).toContain('system-status')
    expect(ids).toContain('settings')
  })

  it('sorts sidebar modules by group then order', () => {
    const groups = sidebarModules.map((m) => m.group)
    const workIdx = groups.lastIndexOf('work')
    const systemIdx = groups.indexOf('system')
    // All work modules should come before system modules
    if (workIdx >= 0 && systemIdx >= 0) {
      expect(workIdx).toBeLessThan(systemIdx)
    }
  })

  it('aggregates command palette actions', () => {
    expect(Array.isArray(allActions)).toBe(true)
  })
})
