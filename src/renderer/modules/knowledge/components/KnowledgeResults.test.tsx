import { fireEvent, render, screen } from '@testing-library/react'
import type { RetrievalResult } from '../../../../../shared/ipc-types'
import { KnowledgeResults } from './KnowledgeResults'

const makeResult = (id: string): RetrievalResult => ({
  chunk: {
    id,
    fileId: 1,
    sourceId: 'src1',
    chunkIndex: 0,
    text: 'fire rated corridor',
    tokenCount: 4,
    charCount: 19,
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
  highlight: '...<mark>fire</mark> rated corridor...',
})

describe('KnowledgeResults', () => {
  it('renders a card for each result', () => {
    render(<KnowledgeResults results={[makeResult('a'), makeResult('b')]} onSelect={() => {}} />)

    expect(screen.getAllByRole('article')).toHaveLength(2)
  })

  it('shows filename and project', () => {
    render(<KnowledgeResults results={[makeResult('a')]} onSelect={() => {}} />)

    expect(screen.getByText('spec.pdf')).toBeInTheDocument()
    expect(screen.getByText('ProjectX')).toBeInTheDocument()
  })

  it('calls onSelect when card is clicked', () => {
    const onSelect = vi.fn()

    render(<KnowledgeResults results={[makeResult('a')]} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('article'))

    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('renders empty state when no results', () => {
    render(<KnowledgeResults results={[]} onSelect={() => {}} query="fire" />)

    expect(screen.getByText(/no results/i)).toBeInTheDocument()
  })
})
