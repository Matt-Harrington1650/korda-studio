import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NotificationPanel } from './NotificationPanel'
import { useNotificationStore } from '@shared/state/notificationStore'
import { useAppStore } from '@shared/state/appStore'

// Minimal bell rect for positioning
const bellRect = { bottom: 600, right: 800, top: 594, left: 780, width: 20, height: 6 } as DOMRect

describe('NotificationPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('kordaAPI', {
      storeGet: vi.fn().mockResolvedValue(null),
      storeSet: vi.fn(),
    })
    useNotificationStore.setState({ notifications: [] })
    useAppStore.setState({ notificationPanelOpen: true })
  })

  it('shows empty state when no notifications', () => {
    render(<NotificationPanel bellRect={bellRect} />)
    expect(screen.getByText('No notifications')).toBeInTheDocument()
  })

  it('renders notifications newest-first', () => {
    useNotificationStore.setState({
      notifications: [
        { id: '1', title: 'First', type: 'info', timestamp: 1000, read: false },
        { id: '2', title: 'Second', type: 'success', timestamp: 2000, read: false },
      ],
    })
    render(<NotificationPanel bellRect={bellRect} />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Second')
    expect(items[1]).toHaveTextContent('First')
  })

  it('mark all read button calls markAllRead', () => {
    useNotificationStore.setState({
      notifications: [{ id: '1', title: 'A', type: 'info', timestamp: 1000, read: false }],
    })
    render(<NotificationPanel bellRect={bellRect} />)
    fireEvent.click(screen.getByRole('button', { name: /mark all read/i }))
    expect(useNotificationStore.getState().notifications[0].read).toBe(true)
  })

  it('clear all button calls clearAll', () => {
    useNotificationStore.setState({
      notifications: [{ id: '1', title: 'A', type: 'info', timestamp: 1000, read: false }],
    })
    render(<NotificationPanel bellRect={bellRect} />)
    fireEvent.click(screen.getByRole('button', { name: /clear all/i }))
    expect(useNotificationStore.getState().notifications).toHaveLength(0)
  })

  it('Escape key closes the panel', () => {
    render(<NotificationPanel bellRect={bellRect} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useAppStore.getState().notificationPanelOpen).toBe(false)
  })

  it('clicking a notification row marks it as read', () => {
    useNotificationStore.setState({
      notifications: [{ id: '1', title: 'A', type: 'info', timestamp: 1000, read: false }],
    })
    render(<NotificationPanel bellRect={bellRect} />)
    fireEvent.click(screen.getByRole('listitem'))
    expect(useNotificationStore.getState().notifications[0].read).toBe(true)
  })

  it('mousedown outside the panel closes it', () => {
    render(
      <div>
        <NotificationPanel bellRect={bellRect} />
        <div data-testid="outside">Outside</div>
      </div>,
    )
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(useAppStore.getState().notificationPanelOpen).toBe(false)
  })

  it('does not render when notificationPanelOpen is false', () => {
    useAppStore.setState({ notificationPanelOpen: false })
    const { container } = render(<NotificationPanel bellRect={bellRect} />)
    expect(container.firstChild).toBeNull()
  })
})
