import { create } from 'zustand'
import { devtools, persist, createJSONStorage } from 'zustand/middleware'
import { createElectronStorage } from '@shared/electronStorage'

export interface Bookmark {
  id: string
  title: string
  url: string
  description?: string
  category: string
}

interface PreferencesState {
  displayName: string
  firmName: string
  disciplines: string
  sidebarCollapsed: boolean
  bookmarks: Bookmark[]
  setDisplayName: (name: string) => void
  setFirmName: (name: string) => void
  setDisciplines: (disciplines: string) => void
  toggleSidebar: () => void
  addBookmark: (bookmark: Bookmark) => void
  updateBookmark: (id: string, updates: Partial<Omit<Bookmark, 'id'>>) => void
  removeBookmark: (id: string) => void
  pinnedProjects: string[]
  setPinnedProjects: (projects: string[]) => void
}

export const usePreferencesStore = create<PreferencesState>()(
  devtools(
    persist(
      (set) => ({
        displayName: '',
        firmName: '',
        disciplines: '',
        sidebarCollapsed: false,
        bookmarks: [],
        pinnedProjects: [],
        setPinnedProjects: (projects) => set({ pinnedProjects: projects }),
        setDisplayName: (name) => set({ displayName: name }),
        setFirmName: (firmName) => set({ firmName }),
        setDisciplines: (disciplines) => set({ disciplines }),
        toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
        addBookmark: (bookmark) => set((state) => ({ bookmarks: [...state.bookmarks, bookmark] })),
        updateBookmark: (id, updates) =>
          set((state) => ({
            bookmarks: state.bookmarks.map((b) => (b.id === id ? { ...b, ...updates } : b)),
          })),
        removeBookmark: (id) =>
          set((state) => ({
            bookmarks: state.bookmarks.filter((b) => b.id !== id),
          })),
      }),
      {
        name: 'korda-preferences',
        storage: createJSONStorage(() => createElectronStorage('preferences')),
      },
    ),
  ),
)
