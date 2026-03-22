import { fireEvent, render, screen } from '@testing-library/react'
import type { RetrievalResult } from '../../../../shared/ipc-types'
import { ChunkPreview } from './ChunkPreview'

const mockResult: RetrievalResult = {
  chunk: {
    id: 'c1',
    fileId: 1,
    sourceId: 'src1',
    chunkIndex: 2,
    text: 'corridor assemblies shall achieve a 2-hour fire rating',
    tokenCount: 10,
    charCount: 52,
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
    sourceId: 'src1',
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
  highlight: '...<mark>fire</mark> rating...',
}

beforeEach(() => {
  Object.defineProperty(window, 'kordaAPI', {
    value: {
      fileIndexOpen: vi.fn().mockResolvedValue(''),
      knowledgeAdjacent: vi.fn().mockResolvedValue({ prev: null, next: null }),
    },
    writable: true,
  })
})

describe('ChunkPreview', () => {
  it('renders file name and section title', () => {
    render(<ChunkPreview result={mockResult} onClose={() => {}} />)

    expect(screen.getByText('spec.pdf')).toBeInTheDocument()
    expect(screen.getByText(/Section 4\.2/)).toBeInTheDocument()
  })

  it('renders chunk text', () => {
    render(<ChunkPreview result={mockResult} onClose={() => {}} />)

    expect(screen.getByText(/corridor assemblies/)).toBeInTheDocument()
  })

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn()

    render(<ChunkPreview result={mockResult} onClose={onClose} />)
    fireEvent.click(screen.getByLabelText('close preview'))

    expect(onClose).toHaveBeenCalled()
  })

  it('calls fileIndexOpen when Open File clicked', () => {
    render(<ChunkPreview result={mockResult} onClose={() => {}} />)
    fireEvent.click(screen.getByText(/open file/i))

    expect(window.kordaAPI.fileIndexOpen).toHaveBeenCalledWith('/docs/spec.pdf')
  })
})
