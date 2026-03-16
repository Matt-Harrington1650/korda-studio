import { useEffect } from 'react'
import { Bell, CheckCircle, Info, AlertTriangle, XCircle } from 'lucide-react'
import { useNotificationStore } from '@shared/state/notificationStore'
import { useAppStore } from '@shared/state/appStore'
import type { AppNotification } from '@shared/state/notificationStore'

const icons = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function NotificationRow({ notification }: { notification: AppNotification }) {
  const markRead = useNotificationStore((s) => s.markRead)
  const Icon = icons[notification.type]

  return (
    <li
      className="flex gap-3 px-4 py-3 hover:bg-surface-raised transition-colors cursor-pointer"
      onClick={() => markRead(notification.id)}
    >
      <Icon size={14} className="mt-0.5 shrink-0 text-text-secondary" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm text-text-primary font-medium leading-tight">
            {notification.title}
          </span>
          {!notification.read && (
            <span className="w-1.5 h-1.5 rounded-full bg-brand shrink-0 mt-1" />
          )}
        </div>
        {notification.body && (
          <p className="text-[11px] text-text-secondary mt-0.5 line-clamp-2">{notification.body}</p>
        )}
        <span className="text-[10px] text-text-secondary mt-1 block">
          {formatRelativeTime(notification.timestamp)}
        </span>
      </div>
    </li>
  )
}

interface NotificationPanelProps {
  bellRect: DOMRect | null
}

export function NotificationPanel({ bellRect }: NotificationPanelProps) {
  const { notifications, markAllRead, clearAll } = useNotificationStore()
  const { notificationPanelOpen, closeNotificationPanel } = useAppStore()

  useEffect(() => {
    if (!notificationPanelOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeNotificationPanel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [notificationPanelOpen, closeNotificationPanel])

  useEffect(() => {
    if (!notificationPanelOpen) return
    const handleMouseDown = (e: MouseEvent) => {
      const panel = document.getElementById('notification-panel')
      if (panel && !panel.contains(e.target as Node)) {
        closeNotificationPanel()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [notificationPanelOpen, closeNotificationPanel])

  if (!notificationPanelOpen) return null

  // Position above and aligned to right edge of bell
  const right = bellRect ? window.innerWidth - bellRect.right : 16
  const bottom = bellRect ? window.innerHeight - bellRect.top + 4 : 40

  const sorted = [...notifications].sort((a, b) => b.timestamp - a.timestamp)

  return (
    <div
      id="notification-panel"
      style={{ right, bottom }}
      className="fixed z-50 w-80 bg-surface-overlay border border-border rounded shadow-xl flex flex-col max-h-96"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <Bell size={12} />
          Notifications
        </div>
        <div className="flex gap-2">
          <button
            onClick={markAllRead}
            className="text-[11px] text-text-secondary hover:text-text-primary transition-colors"
          >
            Mark all read
          </button>
          <span className="text-border">·</span>
          <button
            onClick={clearAll}
            className="text-[11px] text-text-secondary hover:text-text-primary transition-colors"
          >
            Clear all
          </button>
        </div>
      </div>

      {/* Body */}
      {sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-text-secondary">
          <Bell size={20} className="opacity-30 mb-2" />
          <span className="text-sm">No notifications</span>
        </div>
      ) : (
        <ul className="overflow-y-auto flex-1 divide-y divide-border">
          {sorted.map((n) => (
            <NotificationRow key={n.id} notification={n} />
          ))}
        </ul>
      )}
    </div>
  )
}
