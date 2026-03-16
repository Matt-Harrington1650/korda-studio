import { useEffect, useCallback } from 'react'
import { useAppStore } from '@shared/state/appStore'

export function scoreMatch(text: string, query: string): number {
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  if (!q) return 1
  if (lower === q) return 100
  if (lower.startsWith(q)) return 75
  if (lower.includes(q)) return 50
  return 0
}

export function useCommandPaletteShortcut() {
  const { toggleCommandPalette } = useAppStore()

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        toggleCommandPalette()
      }
    },
    [toggleCommandPalette],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
