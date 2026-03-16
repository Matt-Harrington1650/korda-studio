import { create } from 'zustand'
import { devtools, persist, createJSONStorage } from 'zustand/middleware'
import { createElectronStorage } from '@shared/electronStorage'

export interface AppNotification {
  id: string
  title: string
  body?: string
  type: 'info' | 'success' | 'warning' | 'error'
  timestamp: number
  read: boolean
}

const MAX_NOTIFICATIONS = 50

interface NotificationState {
  notifications: AppNotification[]
  addNotification: (n: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => void
  markRead: (id: string) => void
  markAllRead: () => void
  clearAll: () => void
}

export const useNotificationStore = create<NotificationState>()(
  devtools(
    persist(
      (set) => ({
        notifications: [],
        addNotification: (n) =>
          set((state) => {
            const next = [
              ...state.notifications,
              { ...n, id: crypto.randomUUID(), timestamp: Date.now(), read: false },
            ]
            return { notifications: next.length > MAX_NOTIFICATIONS ? next.slice(1) : next }
          }),
        markRead: (id) =>
          set((state) => ({
            notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
          })),
        markAllRead: () =>
          set((state) => ({
            notifications: state.notifications.map((n) => ({ ...n, read: true })),
          })),
        clearAll: () => set({ notifications: [] }),
      }),
      {
        name: 'korda-notifications',
        storage: createJSONStorage(() => createElectronStorage('notifications')),
      },
    ),
  ),
)
