import { useState, useMemo } from 'react'
import { Plus, Search, Star } from 'lucide-react'
import { usePreferencesStore } from '@shared/state/preferencesStore'
import type { Bookmark } from '@shared/state/preferencesStore'
import { BookmarkForm } from './components/BookmarkForm'
import { BookmarkList } from './components/BookmarkList'
import { useToast } from '@shared/hooks/useToast'

export default function BookmarksModule() {
  const { bookmarks, addBookmark, updateBookmark, removeBookmark } = usePreferencesStore()
  const [showForm, setShowForm] = useState(false)
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const { toast } = useToast()

  const filtered = useMemo(() => {
    if (!searchQuery) return bookmarks
    const q = searchQuery.toLowerCase()
    return bookmarks.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.url.toLowerCase().includes(q) ||
        b.description?.toLowerCase().includes(q) ||
        b.category.toLowerCase().includes(q),
    )
  }, [bookmarks, searchQuery])

  const handleSave = (data: Omit<Bookmark, 'id'>) => {
    if (editingBookmark) {
      updateBookmark(editingBookmark.id, data)
      setEditingBookmark(null)
    } else {
      addBookmark({ ...data, id: crypto.randomUUID() })
    }
    toast({ title: 'Bookmark saved', type: 'success' })
    setShowForm(false)
  }

  const handleEdit = (bookmark: Bookmark) => {
    setEditingBookmark(bookmark)
    setShowForm(true)
  }

  if (bookmarks.length === 0 && !showForm) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <Star size={48} className="text-text-secondary opacity-40" />
        <p className="text-sm text-text-secondary">No bookmarks yet</p>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-brand text-white rounded hover:bg-brand-hover transition-colors text-sm"
        >
          Add your first bookmark
        </button>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">Bookmarks</h1>
        <button
          onClick={() => { setEditingBookmark(null); setShowForm(true) }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-brand text-white rounded hover:bg-brand-hover transition-colors text-sm"
        >
          <Plus size={14} /> Add
        </button>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
        <input
          type="text"
          placeholder="Filter bookmarks..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-surface-raised border border-border rounded text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-brand"
        />
      </div>

      {showForm && (
        <BookmarkForm
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditingBookmark(null) }}
          initial={editingBookmark ?? undefined}
        />
      )}

      <BookmarkList bookmarks={filtered} onEdit={handleEdit} onDelete={removeBookmark} />
    </div>
  )
}
