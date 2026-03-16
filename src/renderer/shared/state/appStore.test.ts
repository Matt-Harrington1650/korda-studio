import { useAppStore } from './appStore'

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.setState({ commandPaletteOpen: false })
  })

  it('toggles command palette', () => {
    useAppStore.getState().toggleCommandPalette()
    expect(useAppStore.getState().commandPaletteOpen).toBe(true)
  })

  it('opens and closes command palette', () => {
    useAppStore.getState().openCommandPalette()
    expect(useAppStore.getState().commandPaletteOpen).toBe(true)
    useAppStore.getState().closeCommandPalette()
    expect(useAppStore.getState().commandPaletteOpen).toBe(false)
  })
})
