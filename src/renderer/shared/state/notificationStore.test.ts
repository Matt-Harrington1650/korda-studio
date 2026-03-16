import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useNotificationStore } from './notificationStore'

describe('notificationStore', () => {
  beforeEach(() => {
    vi.stubGlobal('kordaAPI', {
      storeGet: vi.fn().mockResolvedValue(null),
      storeSet: vi.fn(),
    })
    useNotificationStore.setState({ notifications: [] })
  })

  it('adds a notification with id, timestamp, and read=false', () => {
    useNotificationStore.getState().addNotification({ title: 'Hello', type: 'info' })
    const { notifications } = useNotificationStore.getState()
    expect(notifications).toHaveLength(1)
    expect(notifications[0].title).toBe('Hello')
    expect(notifications[0].type).toBe('info')
    expect(notifications[0].id).toBeDefined()
    expect(notifications[0].timestamp).toBeGreaterThan(0)
    expect(notifications[0].read).toBe(false)
  })

  it('adds a notification with optional body', () => {
    useNotificationStore.getState().addNotification({ title: 'Hi', body: 'Details', type: 'success' })
    const { notifications } = useNotificationStore.getState()
    expect(notifications[0].body).toBe('Details')
  })

  it('markRead sets a single notification to read', () => {
    useNotificationStore.getState().addNotification({ title: 'A', type: 'info' })
    const id = useNotificationStore.getState().notifications[0].id
    useNotificationStore.getState().markRead(id)
    expect(useNotificationStore.getState().notifications[0].read).toBe(true)
  })

  it('markRead does not affect other notifications', () => {
    useNotificationStore.getState().addNotification({ title: 'A', type: 'info' })
    useNotificationStore.getState().addNotification({ title: 'B', type: 'info' })
    const idA = useNotificationStore.getState().notifications[0].id
    useNotificationStore.getState().markRead(idA)
    expect(useNotificationStore.getState().notifications[1].read).toBe(false)
  })

  it('markAllRead sets all notifications to read', () => {
    useNotificationStore.getState().addNotification({ title: 'A', type: 'info' })
    useNotificationStore.getState().addNotification({ title: 'B', type: 'warning' })
    useNotificationStore.getState().markAllRead()
    const all = useNotificationStore.getState().notifications
    expect(all.every((n) => n.read)).toBe(true)
  })

  it('clearAll empties the notifications array', () => {
    useNotificationStore.getState().addNotification({ title: 'A', type: 'info' })
    useNotificationStore.getState().clearAll()
    expect(useNotificationStore.getState().notifications).toHaveLength(0)
  })

  it('caps at 50 notifications, dropping the oldest', () => {
    for (let i = 0; i < 51; i++) {
      useNotificationStore.getState().addNotification({ title: `Notification ${i}`, type: 'info' })
    }
    const { notifications } = useNotificationStore.getState()
    expect(notifications).toHaveLength(50)
    // The oldest (index 0, title "Notification 0") should be dropped
    expect(notifications[0].title).toBe('Notification 1')
    expect(notifications[49].title).toBe('Notification 50')
  })
})
