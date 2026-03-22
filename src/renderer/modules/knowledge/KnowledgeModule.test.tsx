import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { IngestionStatus, RetrievalResult } from '../../../shared/ipc-types'
import { KnowledgeModule } from './KnowledgeModule'

const idleStatus: IngestionStatus = {
  new: 0,
  queued: 0,
  extracting: 0,
  chunking: 0,
  contextualizing: 0,
  indexed: 50,
  failed: 0,
  skipped: 0,
  total: 50,
  totalChunks: 1000,
  avgChunksPerFile: 20,
}

const result: RetrievalResult = {
  chunk: {
    id: 'chunk-1',
    fileId: 1,
    sourceId: 'source-1',
    chunkIndex: 0,
    text: 'fire rated corridor assemblies shall achieve a 2-hour rating',
    tokenCount: 10,
    charCount: 60,
    pageNumber: 14,
    sectionTitle: 'Section 4.2',
    sheetName: null,
    embedding: null,
    createdAt: Date.now(),
  },
  file: {
    path: '/docs/spec.pdf',
    name: 'spec.pdf',
    ext: '.pdf',
    sizeBytes: 1000,
    modifiedMs: Date.now(),
    isDir: false,
    sourceId: 'source-1',
    project: 'ProjectX',
    discipline: null,
    docType: null,
    drawingNumber: null,
    revision: null,
    issueStatus: null,
  },
  bm25Score: -1.5,
  vectorDistance: null,
  rrfScore: null,
  highlight: '...<mark>fire</mark> rated corridor...',
}

beforeEach(() => {
  Object.defineProperty(window, 'kordaAPI', {
    value: {
      knowledgeSearch: vi.fn().mockResolvedValue([]),
      ingestionStatus: vi.fn().mockResolvedValue(idleStatus),
      fileIndexSourcesList: vi.fn().mockResolvedValue([]),
      fileIndexProjectsList: vi.fn().mockResolvedValue([]),
      knowledgeAdjacent: vi.fn().mockResolvedValue({ prev: null, next: null }),
      fileIndexOpen: vi.fn().mockResolvedValue(''),
      onIngestionProgress: vi.fn().mockReturnValue(() => {}),
      ingestionRetry: vi.fn().mockResolvedValue(undefined),
    },
    writable: true,
  })
})

describe('KnowledgeModule', () => {
  it('renders the search bar', () => {
    render(<KnowledgeModule />)

    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
  })

  it('calls knowledgeSearch on Enter', async () => {
    render(<KnowledgeModule />)

    const input = screen.getByPlaceholderText(/search/i)
    fireEvent.change(input, { target: { value: 'fire rated' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(window.kordaAPI.knowledgeSearch).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'fire rated' }),
      ),
    )
  })

  it('shows empty state when no results', async () => {
    render(<KnowledgeModule />)

    const input = screen.getByPlaceholderText(/search/i)
    fireEvent.change(input, { target: { value: 'xyz' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(screen.getByText(/no results for "xyz"/i)).toBeInTheDocument())
  })

  it('opens the chunk preview when a result card is selected', async () => {
    vi.mocked(window.kordaAPI.knowledgeSearch).mockResolvedValueOnce([result])

    render(<KnowledgeModule />)

    const input = screen.getByPlaceholderText(/search/i)
    fireEvent.change(input, { target: { value: 'fire rated' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const card = await screen.findByRole('article')
    fireEvent.click(card)

    expect(screen.getByLabelText('close preview')).toBeInTheDocument()
    expect(screen.getByText(/open file/i)).toBeInTheDocument()
  })
})
