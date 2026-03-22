import { render, screen } from '@testing-library/react'
import { IndexStatusBar } from './IndexStatusBar'
import type { SourceStatus } from '../../../../shared/ipc-types'

const mockStatuses: SourceStatus[] = [
  {
    sourceId: 'a',
    displayName: 'Main Server',
    path: '\\\\srv\\share',
    type: 'network-share',
    online: true,
    status: 'idle',
    fileCount: 5000,
    lastCrawledMs: Date.now() - 60_000,
    crawlError: null,
  },
  {
    sourceId: 'b',
    displayName: 'Local Docs',
    path: 'C:\\Projects',
    type: 'local',
    online: true,
    status: 'idle',
    fileCount: 2000,
    lastCrawledMs: Date.now() - 120_000,
    crawlError: null,
  },
]

beforeEach(() => {
  vi.stubGlobal('kordaAPI', {
    fileIndexStatus: vi.fn().mockResolvedValue(mockStatuses),
    onFileIndexProgress: vi.fn().mockReturnValue(() => {}),
  })
})

describe('IndexStatusBar multi-source', () => {
  it('shows total file count across all sources', async () => {
    render(<IndexStatusBar onReindex={vi.fn()} />)
    expect(await screen.findByText(/7,000 files/)).toBeInTheDocument()
  })

  it('shows source count', async () => {
    render(<IndexStatusBar onReindex={vi.fn()} />)
    expect(await screen.findByText(/2 sources/)).toBeInTheDocument()
  })

  it('shows offline warning when a source is offline', async () => {
    const offlineStatuses: SourceStatus[] = [
      { ...mockStatuses[0], online: false, status: 'error' },
      mockStatuses[1],
    ]
    vi.stubGlobal('kordaAPI', {
      fileIndexStatus: vi.fn().mockResolvedValue(offlineStatuses),
      onFileIndexProgress: vi.fn().mockReturnValue(() => {}),
    })
    render(<IndexStatusBar onReindex={vi.fn()} />)
    expect(await screen.findByText(/Main Server/)).toBeInTheDocument()
  })

  it('returns null when all sources are not-configured', async () => {
    vi.stubGlobal('kordaAPI', {
      fileIndexStatus: vi.fn().mockResolvedValue([]),
      onFileIndexProgress: vi.fn().mockReturnValue(() => {}),
    })
    const { container } = render(<IndexStatusBar onReindex={vi.fn()} />)
    await new Promise((r) => setTimeout(r, 50))
    expect(container.firstChild).toBeNull()
  })
})
