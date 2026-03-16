import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface AppState {
  commandPaletteOpen: boolean
  toggleCommandPalette: () => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  notificationPanelOpen: boolean
  toggleNotificationPanel: () => void
  openNotificationPanel: () => void
  closeNotificationPanel: () => void
}

export const useAppStore = create<AppState>()(
  devtools((set) => ({
    commandPaletteOpen: false,
    toggleCommandPalette: () => set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
    openCommandPalette: () => set({ commandPaletteOpen: true }),
    closeCommandPalette: () => set({ commandPaletteOpen: false }),
    notificationPanelOpen: false,
    toggleNotificationPanel: () =>
      set((state) => ({ notificationPanelOpen: !state.notificationPanelOpen })),
    openNotificationPanel: () => set({ notificationPanelOpen: true }),
    closeNotificationPanel: () => set({ notificationPanelOpen: false }),
  })),
)
