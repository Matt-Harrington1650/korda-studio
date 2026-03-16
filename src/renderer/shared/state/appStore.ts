import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface AppState {
  commandPaletteOpen: boolean
  toggleCommandPalette: () => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
}

export const useAppStore = create<AppState>()(
  devtools((set) => ({
    commandPaletteOpen: false,
    toggleCommandPalette: () => set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
    openCommandPalette: () => set({ commandPaletteOpen: true }),
    closeCommandPalette: () => set({ commandPaletteOpen: false }),
  })),
)
