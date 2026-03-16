import { NavLink, Outlet } from 'react-router'
import { Palette, User, Link2, Info } from 'lucide-react'

const settingsNav = [
  { path: '/settings', label: 'Appearance', icon: Palette, end: true },
  { path: '/settings/profile', label: 'Profile', icon: User },
  { path: '/settings/connections', label: 'Connections', icon: Link2 },
  { path: '/settings/about', label: 'About', icon: Info },
]

export default function SettingsModule() {
  return (
    <div className="flex h-full">
      <div className="w-48 border-r border-border p-4 space-y-1">
        <h2 className="text-xs font-medium text-text-secondary uppercase tracking-widest mb-3">
          Settings
        </h2>
        {settingsNav.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
                isActive
                  ? 'bg-brand-muted text-text-primary'
                  : 'text-text-secondary hover:bg-white/5'
              }`
            }
          >
            <item.icon size={16} />
            {item.label}
          </NavLink>
        ))}
      </div>
      <div className="flex-1 p-8 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
