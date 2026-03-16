import { useLocation, useNavigate } from 'react-router'
import { Bell } from 'lucide-react'
import { useNotificationStore } from '@shared/state/notificationStore'
import { useAppStore } from '@shared/state/appStore'
import { useEffect, useRef, useState } from 'react'
import type { AppNotification } from '@shared/state/notificationStore'

const routeNames: Record<string, string> = {
  '/': 'Home',
  '/bookmarks': 'Bookmarks',
  '/status': 'System Status',
  '/settings': 'Settings',
  '/settings/appearance': 'Settings > Appearance',
  '/settings/profile': 'Settings > Profile',
  '/settings/connections': 'Settings > Connections',
  '/settings/about': 'Settings > About',
}

interface StatusStripProps {
  onBellRect?: (rect: DOMRect) => void
}

export function StatusStrip({ onBellRect }: StatusStripProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const { notifications } = useNotificationStore()
  const { toggleNotificationPanel } = useAppStore()
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const bellRef = useRef<HTMLButtonElement>(null)

  const unreadCount = notifications.filter((n: AppNotification) => !n.read).length

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const breadcrumb = routeNames[location.pathname] ?? 'Home'

  const handleBellClick = () => {
    if (onBellRect && bellRef.current) {
      onBellRect(bellRef.current.getBoundingClientRect())
    }
    toggleNotificationPanel()
  }

  return (
    <div className="h-6 bg-surface-raised border-t border-border flex items-center justify-between px-3 text-[11px] text-text-secondary">
      {/* Left: breadcrumb */}
      <span>{breadcrumb}</span>

      {/* Right: status indicators */}
      <div className="flex items-center gap-3">
        {/* Connection status */}
        <button
          aria-label="View system status"
          onClick={() => navigate('/status')}
          className="flex items-center gap-1.5 hover:text-text-primary transition-colors"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-success' : 'bg-error'}`} />
          <span>{isOnline ? 'Connected' : 'Offline'}</span>
        </button>

        {/* Notification bell */}
        <button
          ref={bellRef}
          aria-label="Notifications"
          onClick={handleBellClick}
          className="relative flex items-center gap-1 hover:text-text-primary transition-colors"
        >
          <Bell size={12} />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[14px] h-[14px] px-0.5 bg-error text-white text-[9px] font-bold rounded-full leading-none">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      </div>
    </div>
  )
}
