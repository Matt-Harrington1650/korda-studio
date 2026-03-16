import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export interface AppNotification {
  id: string
  title: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
  timestamp: number
  read: boolean
}

interface NotificationState {
  notifications: AppNotification[]
  unreadCount: number
}

export const useNotificationStore = create<NotificationState>()(
  devtools(() => ({
    notifications: [],
    unreadCount: 0,
  })),
)
