import { ExternalLink, Edit2, Trash2 } from 'lucide-react'
import type { Bookmark } from '@shared/state/preferencesStore'

interface BookmarkListProps {
  bookmarks: Bookmark[]
  onEdit: (bookmark: Bookmark) => void
  onDelete: (id: string) => void
}

export function BookmarkList({ bookmarks, onEdit, onDelete }: BookmarkListProps) {
  const grouped = bookmarks.reduce(
    (acc, b) => {
      const cat = b.category || 'General'
      if (!acc[cat]) acc[cat] = []
      acc[cat].push(b)
      return acc
    },
    {} as Record<string, Bookmark[]>,
  )

  return (
    <div className="space-y-6">
      {Object.entries(grouped)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, items]) => (
          <div key={category}>
            <h3 className="text-xs font-medium text-text-secondary uppercase tracking-widest mb-2">
              {category}
            </h3>
            <div className="space-y-1">
              {items.map((bookmark) => (
                <div
                  key={bookmark.id}
                  className="flex items-center gap-3 px-3 py-2 rounded hover:bg-white/5 group transition-colors"
                >
                  <button
                    onClick={() => window.kordaAPI.openExternal(bookmark.url)}
                    className="flex-1 text-left"
                  >
                    <div className="text-sm text-text-primary">{bookmark.title}</div>
                    {bookmark.description && (
                      <div className="text-[11px] text-text-secondary mt-0.5">
                        {bookmark.description}
                      </div>
                    )}
                    <div className="text-[11px] text-text-secondary opacity-50 mt-0.5">
                      {bookmark.url}
                    </div>
                  </button>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => window.kordaAPI.openExternal(bookmark.url)}
                      aria-label="Open link"
                      className="p-1 hover:text-brand"
                    >
                      <ExternalLink size={14} />
                    </button>
                    <button
                      onClick={() => onEdit(bookmark)}
                      aria-label="Edit bookmark"
                      className="p-1 hover:text-brand"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => onDelete(bookmark.id)}
                      aria-label="Delete bookmark"
                      className="p-1 hover:text-error"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  )
}
