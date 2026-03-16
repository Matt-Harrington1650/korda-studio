import { useNotificationStore } from '@shared/state/notificationStore'

export function useNotifications() {
  const addNotification = useNotificationStore((s) => s.addNotification)
  return { notify: addNotification }
}
