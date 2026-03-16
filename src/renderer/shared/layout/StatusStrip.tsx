import { useLocation, useNavigate } from 'react-router'
import { Bell } from 'lucide-react'
import { useNotificationStore } from '@shared/state/notificationStore'
import { useEffect, useState } from 'react'

const routeNames: Record<string, string> = {
  '/': 'Home',
  '/bookmarks': 'Bookmarks',
  '/status': 'System Status',
  '/settings': 'Settings',
  '/settings/profile': 'Settings > Profile',
  '/settings/connections': 'Settings > Connections',
  '/settings/about': 'Settings > About',
}

export function StatusStrip() {
  const location = useLocation()
  const navigate = useNavigate()
  const { unreadCount } = useNotificationStore()
  const [isOnline, setIsOnline] = useState(navigator.onLine)

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

  return (
    <div className="h-6 bg-surface-raised border-t border-border flex items-center justify-between px-3 text-[11px] text-text-secondary">
      {/* Left: breadcrumb */}
      <span>{breadcrumb}</span>

      {/* Right: status indicators */}
      <div className="flex items-center gap-3">
        {/* Connection status */}
        <button
          onClick={() => navigate('/status')}
          className="flex items-center gap-1.5 hover:text-text-primary transition-colors"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-success' : 'bg-error'}`} />
          <span>{isOnline ? 'Connected' : 'Offline'}</span>
        </button>

        {/* Notification bell */}
        <button
          aria-label="Notifications"
          className="flex items-center gap-1 hover:text-text-primary transition-colors"
        >
          <Bell size={12} />
          <span>{unreadCount}</span>
        </button>
      </div>
    </div>
  )
}
