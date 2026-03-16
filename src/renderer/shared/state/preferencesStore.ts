import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

export interface Bookmark {
  id: string
  title: string
  url: string
  description?: string
  category: string
}

interface PreferencesState {
  displayName: string
  sidebarCollapsed: boolean
  bookmarks: Bookmark[]
  setDisplayName: (name: string) => void
  toggleSidebar: () => void
  addBookmark: (bookmark: Bookmark) => void
  updateBookmark: (id: string, updates: Partial<Omit<Bookmark, 'id'>>) => void
  removeBookmark: (id: string) => void
}

export const usePreferencesStore = create<PreferencesState>()(
  devtools(
    persist(
      (set) => ({
        displayName: '',
        sidebarCollapsed: false,
        bookmarks: [],
        setDisplayName: (name) => set({ displayName: name }),
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
      { name: 'korda-preferences' },
    ),
  ),
)
