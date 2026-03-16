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
