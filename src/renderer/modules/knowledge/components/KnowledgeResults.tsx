import type { RetrievalResult } from '../../../../shared/ipc-types'

interface KnowledgeResultsProps {
  results: RetrievalResult[]
  onSelect: (result: RetrievalResult) => void
  query?: string
}

function sanitizeHighlight(html: string): string {
  return html.replace(/<(?!\/?mark\b)[^>]+>/g, '')
}

function normalizeExt(ext: string): string {
  if (!ext) {
    return ''
  }

  return ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
}

function getExtBadge(ext: string): string {
  const normalized = normalizeExt(ext)

  switch (normalized) {
    case '.pdf':
      return 'PDF'
    case '.docx':
      return 'DOC'
    case '.xlsx':
    case '.xls':
      return 'XLS'
    case '.csv':
      return 'CSV'
    case '.txt':
    case '.md':
      return 'TXT'
    default:
      return normalized ? normalized.slice(1).toUpperCase() : 'FILE'
  }
}

export function KnowledgeResults({ results, onSelect, query }: KnowledgeResultsProps) {
  if (results.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-text-secondary">
        {query
          ? `No results for "${query}". Try broader terms or check Connections.`
          : 'Search your indexed engineering documents'}
      </div>
    )
  }

  return (
    <div className="space-y-2 p-4">
      {results.map((result) => {
        const meta =
          result.chunk.sectionTitle ?? result.chunk.sheetName ?? `Page ${result.chunk.pageNumber}`
        const previewHtml = sanitizeHighlight(result.highlight || result.chunk.text.slice(0, 200))

        return (
          <article
            key={result.chunk.id}
            role="article"
            onClick={() => onSelect(result)}
            className="cursor-pointer rounded border border-border bg-surface-raised px-3 py-2 hover:bg-white/5 hover:border-accent"
          >
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded border border-border px-1 py-0.5 text-[10px] text-text-secondary">
                {getExtBadge(result.file.ext)}
              </span>
              <span className="truncate text-sm font-medium text-text-primary">
                {result.file.name}
              </span>
              {result.file.project && (
                <span className="ml-auto shrink-0 text-xs text-text-secondary">
                  {result.file.project}
                </span>
              )}
            </div>
            {meta && <div className="mb-1 text-xs text-text-secondary">{meta}</div>}
            <div
              className="line-clamp-2 text-xs text-text-secondary"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </article>
        )
      })}
    </div>
  )
}
