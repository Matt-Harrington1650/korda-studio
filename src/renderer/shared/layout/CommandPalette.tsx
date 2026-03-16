import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useAppStore } from '@shared/state/appStore'
import { modules, allActions } from '../../moduleRegistry'
import { scoreMatch } from '@shared/hooks/useCommandPalette'

interface PaletteItem {
  id: string
  label: string
  category: string
  icon?: React.ComponentType<{ size?: number }>
  action: () => void
}

export function CommandPalette() {
  const { commandPaletteOpen, closeCommandPalette } = useAppStore()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [recentIds, setRecentIds] = useState<string[]>([])

  const listboxId = 'command-palette-listbox'

  const items: PaletteItem[] = useMemo(() => {
    const navItems: PaletteItem[] = modules.map((m) => ({
      id: `nav:${m.id}`,
      label: m.name,
      category: 'Navigation',
      icon: m.icon,
      action: () => {
        navigate(m.path)
        setRecentIds((prev) => [m.id, ...prev.filter((id) => id !== m.id)].slice(0, 5))
        closeCommandPalette()
      },
    }))

    const actionItems: PaletteItem[] = allActions.map((a) => ({
      id: a.id,
      label: a.label,
      category: 'Action',
      icon: a.icon,
      action: () => {
        a.execute()
        setRecentIds((prev) => [a.id, ...prev.filter((id) => id !== a.id)].slice(0, 5))
        closeCommandPalette()
      },
    }))

    return [...navItems, ...actionItems]
  }, [navigate, closeCommandPalette])

  const filtered = useMemo(() => {
    if (!query) {
      const recents = recentIds
        .map((id) => items.find((item) => item.id === id || item.id === `nav:${id}`))
        .filter(Boolean) as PaletteItem[]
      const rest = items.filter(
        (item) => !recentIds.some((id) => item.id === id || item.id === `nav:${id}`),
      )
      return [...recents, ...rest]
    }
    return items
      .map((item) => ({ item, score: scoreMatch(item.label, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ item }) => item)
  }, [items, query, recentIds])

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [commandPaletteOpen])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  if (!commandPaletteOpen) return null

  const selectedItemId = filtered[selectedIndex]?.id
    ? `palette-item-${filtered[selectedIndex].id}`
    : undefined

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        filtered[selectedIndex]?.action()
        break
      case 'Escape':
        e.preventDefault()
        closeCommandPalette()
        break
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={closeCommandPalette}
      role="dialog"
      aria-label="Command palette"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-lg bg-surface-overlay border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={filtered.length > 0}
          aria-controls={listboxId}
          aria-activedescendant={selectedItemId}
          type="text"
          placeholder="Search or jump to..."
          className="w-full px-4 py-3 bg-transparent text-text-primary text-sm outline-none border-b border-border placeholder:text-text-secondary"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {!query && recentIds.length > 0 && (
          <div className="px-4 py-1 text-[10px] text-text-secondary uppercase tracking-widest">
            Recent
          </div>
        )}
        <div id={listboxId} className="max-h-64 overflow-y-auto" role="listbox">
          {filtered.map((item, i) => (
            <button
              key={item.id}
              id={`palette-item-${item.id}`}
              role="option"
              aria-selected={i === selectedIndex}
              className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-left transition-colors ${
                i === selectedIndex
                  ? 'bg-brand-muted text-text-primary'
                  : 'text-text-secondary hover:bg-white/5'
              }`}
              onClick={item.action}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              {item.icon && <item.icon size={16} />}
              <span className="flex-1">{item.label}</span>
              <span className="text-[10px] text-text-secondary opacity-60">[{item.category}]</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-sm text-text-secondary text-center">
              No results found
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
