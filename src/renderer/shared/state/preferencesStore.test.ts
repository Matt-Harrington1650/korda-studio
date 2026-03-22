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
      firmName: '',
      disciplines: '',
      sidebarCollapsed: false,
      bookmarks: [],
    })
  })

  it('has correct initial state', () => {
    const state = usePreferencesStore.getState()
    expect(state.displayName).toBe('')
    expect(state.firmName).toBe('')
    expect(state.disciplines).toBe('')
    expect(state.sidebarCollapsed).toBe(false)
    expect(state.bookmarks).toEqual([])
  })

  it('sets display name', () => {
    usePreferencesStore.getState().setDisplayName('Alice')
    expect(usePreferencesStore.getState().displayName).toBe('Alice')
  })

  it('sets firm name', () => {
    usePreferencesStore.getState().setFirmName('KORDA')
    expect(usePreferencesStore.getState().firmName).toBe('KORDA')
  })

  it('sets disciplines', () => {
    usePreferencesStore.getState().setDisciplines('Civil, Structural')
    expect(usePreferencesStore.getState().disciplines).toBe('Civil, Structural')
  })

  it('toggles sidebar', () => {
    usePreferencesStore.getState().toggleSidebar()
    expect(usePreferencesStore.getState().sidebarCollapsed).toBe(true)
    usePreferencesStore.getState().toggleSidebar()
    expect(usePreferencesStore.getState().sidebarCollapsed).toBe(false)
  })
})
