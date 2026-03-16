import { useState } from 'react'
import { X } from 'lucide-react'
import type { Bookmark } from '@shared/state/preferencesStore'

interface BookmarkFormProps {
  onSave: (bookmark: Omit<Bookmark, 'id'>) => void
  onCancel: () => void
  initial?: Bookmark
}

export function BookmarkForm({ onSave, onCancel, initial }: BookmarkFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [category, setCategory] = useState(initial?.category ?? 'General')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !url.trim()) return
    onSave({
      title: title.trim(),
      url: url.trim(),
      description: description.trim(),
      category: category.trim() || 'General',
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-surface-raised border border-border rounded-lg p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">
          {initial ? 'Edit Bookmark' : 'Add Bookmark'}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="text-text-secondary hover:text-text-primary"
        >
          <X size={16} />
        </button>
      </div>
      <input
        type="text"
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full px-3 py-2 bg-surface-base border border-border rounded text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-brand"
        required
      />
      <input
        type="url"
        placeholder="https://..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className="w-full px-3 py-2 bg-surface-base border border-border rounded text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-brand"
        required
      />
      <input
        type="text"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="w-full px-3 py-2 bg-surface-base border border-border rounded text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-brand"
      />
      <input
        type="text"
        placeholder="Category"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="w-full px-3 py-2 bg-surface-base border border-border rounded text-sm text-text-primary placeholder:text-text-secondary outline-none focus:border-brand"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-3 py-1.5 text-sm bg-brand text-white rounded hover:bg-brand-hover transition-colors"
        >
          {initial ? 'Update' : 'Add'}
        </button>
      </div>
    </form>
  )
}
