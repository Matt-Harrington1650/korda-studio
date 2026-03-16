import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useNotifications } from './useNotifications'
import { useNotificationStore } from '@shared/state/notificationStore'
import { renderHook, act } from '@testing-library/react'

describe('useNotifications', () => {
  beforeEach(() => {
    vi.stubGlobal('kordaAPI', {
      storeGet: vi.fn().mockResolvedValue(null),
      storeSet: vi.fn(),
    })
    useNotificationStore.setState({ notifications: [] })
  })

  it('notify() adds a notification to the store', () => {
    const { result } = renderHook(() => useNotifications())
    act(() => {
      result.current.notify({ title: 'Test alert', type: 'warning' })
    })
    const { notifications } = useNotificationStore.getState()
    expect(notifications).toHaveLength(1)
    expect(notifications[0].title).toBe('Test alert')
    expect(notifications[0].type).toBe('warning')
    expect(notifications[0].read).toBe(false)
  })

  it('notify() with body includes body in notification', () => {
    const { result } = renderHook(() => useNotifications())
    act(() => {
      result.current.notify({ title: 'With body', body: 'Details here', type: 'info' })
    })
    const { notifications } = useNotificationStore.getState()
    expect(notifications[0].body).toBe('Details here')
  })
})
