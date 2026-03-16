import { usePreferencesStore } from '@shared/state/preferencesStore'
import { Command, Settings, Star, Clock } from 'lucide-react'
import { useNavigate } from 'react-router'

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function HomeModule() {
  const { displayName } = usePreferencesStore()
  const navigate = useNavigate()
  const name = displayName || 'Engineer'

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="flex justify-center p-8">
      <div className="w-full max-w-3xl space-y-8">
        {/* Greeting */}
        <div>
          <h1 className="text-2xl font-semibold text-text-primary">
            {getGreeting()}, {name}
          </h1>
          <p className="text-sm text-text-secondary mt-1">{today}</p>
        </div>

        {/* Quick actions */}
        <div>
          <h2 className="text-xs font-medium text-text-secondary uppercase tracking-widest mb-3">
            Quick Actions
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={() => {
                /* command palette handled by Ctrl+K */
              }}
              className="flex items-center gap-3 p-4 bg-surface-raised border border-border rounded-lg hover:bg-white/5 transition-colors text-left"
            >
              <Command size={18} className="text-brand" />
              <div>
                <div className="text-sm text-text-primary">Command Palette</div>
                <div className="text-[11px] text-text-secondary">Ctrl+K</div>
              </div>
            </button>
            <button
              onClick={() => navigate('/settings')}
              className="flex items-center gap-3 p-4 bg-surface-raised border border-border rounded-lg hover:bg-white/5 transition-colors text-left"
            >
              <Settings size={18} className="text-brand" />
              <div>
                <div className="text-sm text-text-primary">Settings</div>
                <div className="text-[11px] text-text-secondary">Preferences</div>
              </div>
            </button>
            <button
              onClick={() => navigate('/bookmarks')}
              className="flex items-center gap-3 p-4 bg-surface-raised border border-border rounded-lg hover:bg-white/5 transition-colors text-left"
            >
              <Star size={18} className="text-brand" />
              <div>
                <div className="text-sm text-text-primary">Bookmarks</div>
                <div className="text-[11px] text-text-secondary">Firm resources</div>
              </div>
            </button>
          </div>
        </div>

        {/* Activity feed placeholder */}
        <div className="flex flex-col items-center justify-center py-12 border border-border border-dashed rounded-lg">
          <Clock size={32} className="text-text-secondary opacity-40 mb-3" />
          <p className="text-sm text-text-secondary">Activity feed coming soon</p>
          <p className="text-[11px] text-text-secondary mt-1 opacity-60">
            Project updates, reviews, and notifications will appear here
          </p>
        </div>

        {/* Version footer */}
        <div className="text-[11px] text-text-secondary opacity-40 text-center">
          KORDA Studio v0.1.0
        </div>
      </div>
    </div>
  )
}
