import { usePreferencesStore } from './preferencesStore'
import { vi } from 'vitest'

describe('preferencesStore', () => {
  beforeEach(() => {
    vi.stubGlobal('kordaAPI', {
      storeGet: vi.fn().mockResolvedValue(null),
      storeSet: vi.fn(),
    })
    usePreferencesStore.setState({
      displayName: '',
      sidebarCollapsed: false,
      bookmarks: [],
      pinnedProjects: [],
    })
  })

  it('has correct initial state', () => {
    const state = usePreferencesStore.getState()
    expect(state.displayName).toBe('')
    expect(state.sidebarCollapsed).toBe(false)
    expect(state.bookmarks).toEqual([])
  })

  it('sets display name', () => {
    usePreferencesStore.getState().setDisplayName('Alice')
    expect(usePreferencesStore.getState().displayName).toBe('Alice')
  })

  it('toggles sidebar', () => {
    usePreferencesStore.getState().toggleSidebar()
    expect(usePreferencesStore.getState().sidebarCollapsed).toBe(true)
    usePreferencesStore.getState().toggleSidebar()
    expect(usePreferencesStore.getState().sidebarCollapsed).toBe(false)
  })
})

describe('pinnedProjects', () => {
  it('defaults to empty array', () => {
    const { pinnedProjects } = usePreferencesStore.getState()
    expect(pinnedProjects).toEqual([])
  })

  it('setPinnedProjects updates the list', () => {
    usePreferencesStore.getState().setPinnedProjects(['ProjectA', 'ProjectB'])
    expect(usePreferencesStore.getState().pinnedProjects).toEqual(['ProjectA', 'ProjectB'])
  })
})
