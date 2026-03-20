import { render, screen } from '@testing-library/react'
import { SearchResults } from './SearchResults'
import type { FileEntry } from '../../../../shared/ipc-types'
import type { FileSource } from '../../../../shared/ipc-types'

it('shows source display name below filename when showSourceLabel is true', () => {
  const source: FileSource = {
    id: 'a',
    displayName: 'Main Server',
    path: '\\\\srv\\a',
    type: 'network-share',
    enabled: true,
  }
  const result: FileEntry = {
    path: '\\\\srv\\a\\proj\\file.pdf',
    name: 'file.pdf',
    ext: 'pdf',
    sizeBytes: 1000,
    modifiedMs: Date.now(),
    isDir: false,
    sourceId: 'a',
    project: 'proj',
    discipline: null,
    docType: null,
    drawingNumber: null,
    revision: null,
    issueStatus: null,
  }
  render(
    <SearchResults results={[result]} onOpenError={vi.fn()} showSourceLabel sources={[source]} />,
  )
  expect(screen.getByText('Main Server')).toBeInTheDocument()
})

it('does not show source label when showSourceLabel is false', () => {
  const source: FileSource = {
    id: 'a',
    displayName: 'Main Server',
    path: '\\\\srv\\a',
    type: 'network-share',
    enabled: true,
  }
  const result: FileEntry = {
    path: '\\\\srv\\a\\proj\\file.pdf',
    name: 'file.pdf',
    ext: 'pdf',
    sizeBytes: 1000,
    modifiedMs: Date.now(),
    isDir: false,
    sourceId: 'a',
    project: 'proj',
    discipline: null,
    docType: null,
    drawingNumber: null,
    revision: null,
    issueStatus: null,
  }
  render(<SearchResults results={[result]} onOpenError={vi.fn()} sources={[source]} />)
  expect(screen.queryByText('Main Server')).toBeNull()
})
