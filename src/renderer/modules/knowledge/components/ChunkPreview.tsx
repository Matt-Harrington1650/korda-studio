import { useEffect, useState } from 'react'
import type { ChunkRecord, RetrievalResult } from '../../../../shared/ipc-types'

interface ChunkPreviewProps {
  result: RetrievalResult
  onClose: () => void
}

export function ChunkPreview({ result, onClose }: ChunkPreviewProps) {
  const { file } = result
  const [currentChunk, setCurrentChunk] = useState(result.chunk)
  const [prevChunk, setPrevChunk] = useState<ChunkRecord | null>(null)
  const [nextChunk, setNextChunk] = useState<ChunkRecord | null>(null)

  useEffect(() => {
    setCurrentChunk(result.chunk)
  }, [result])

  useEffect(() => {
    let cancelled = false

    void window.kordaAPI
      .knowledgeAdjacent(currentChunk.fileId, currentChunk.chunkIndex)
      .then(({ prev, next }) => {
        if (cancelled) {
          return
        }
        setPrevChunk(prev)
        setNextChunk(next)
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        setPrevChunk(null)
        setNextChunk(null)
      })

    return () => {
      cancelled = true
    }
  }, [currentChunk.fileId, currentChunk.chunkIndex])

  const meta = [
    currentChunk.sectionTitle,
    currentChunk.pageNumber ? `Page ${currentChunk.pageNumber}` : null,
    currentChunk.sheetName,
    file.project,
  ]
    .filter(Boolean)
    .join(' · ')

  const copyExcerpt = () => {
    const label =
      currentChunk.sectionTitle ??
      currentChunk.sheetName ??
      (currentChunk.pageNumber ? `Page ${currentChunk.pageNumber}` : '')
    const text = `"${currentChunk.text}" - ${file.name}, ${label}, ${file.project ?? ''}`

    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text)
    }
  }

  return (
    <div className="flex h-full flex-col border-l border-border bg-surface">
      <div className="flex items-start justify-between border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-medium text-text-primary">{file.name}</div>
          {meta && <div className="mt-0.5 text-xs text-text-secondary">{meta}</div>}
        </div>
        <button
          aria-label="close preview"
          onClick={onClose}
          className="ml-2 shrink-0 text-text-secondary hover:text-text-primary"
        >
          ×
        </button>
      </div>

      <div className="flex gap-2 border-b border-border px-4 py-2 text-xs">
        <button
          disabled={!prevChunk}
          onClick={() => prevChunk && setCurrentChunk(prevChunk)}
          className="disabled:opacity-40 hover:text-accent"
        >
          ← Prev chunk
        </button>
        <button
          disabled={!nextChunk}
          onClick={() => nextChunk && setCurrentChunk(nextChunk)}
          className="ml-auto disabled:opacity-40 hover:text-accent"
        >
          Next chunk →
        </button>
      </div>

      <div className="flex-1 overflow-y-auto whitespace-pre-wrap px-4 py-3 text-sm text-text-primary">
        {currentChunk.text}
      </div>

      <div className="flex gap-2 border-t border-border px-4 py-3 text-xs">
        <button
          onClick={() => window.kordaAPI.fileIndexOpen(file.path)}
          className="rounded bg-accent px-3 py-1.5 text-white hover:bg-accent/80"
        >
          Open File
        </button>
        <button
          onClick={copyExcerpt}
          className="rounded border border-border px-3 py-1.5 text-text-secondary hover:text-text-primary"
        >
          Copy Excerpt
        </button>
      </div>
    </div>
  )
}
