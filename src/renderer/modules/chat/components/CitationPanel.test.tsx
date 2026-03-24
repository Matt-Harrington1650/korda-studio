import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { CitationPanel, type CitationPanelHandle } from './CitationPanel'

const citations = [
  {
    citationIndex: 1,
    fileId: 7,
    filePath: '/docs/fire-rating.pdf',
    fileName: 'fire-rating.pdf',
    chunkId: 'chunk-1',
    excerpt: 'corridor assemblies shall achieve 2 hours',
    pageNumber: 5,
    sectionTitle: 'Fire Rating',
    sourceId: 'src1',
  },
]

describe('CitationPanel', () => {
  it('toggles open and shows citations plus the evidence badge', () => {
    render(<CitationPanel citations={citations} evidenceStatus="supported" />)

    fireEvent.click(screen.getByRole('button', { name: /show sources/i }))

    expect(screen.getByText(/fully supported by documents/i)).toBeInTheDocument()
    expect(screen.getByText('fire-rating.pdf')).toBeInTheDocument()
    expect(screen.getByText(/corridor assemblies shall achieve 2 hours/i)).toBeInTheDocument()
  })

  it('exposes scrollToIndex through the panel ref', () => {
    const ref = createRef<CitationPanelHandle>()
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value() {},
    })
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(scrollIntoView)

    render(<CitationPanel ref={ref} citations={citations} evidenceStatus="partial" defaultOpen />)

    ref.current?.scrollToIndex(0)

    expect(scrollIntoView).toHaveBeenCalled()
  })
})
