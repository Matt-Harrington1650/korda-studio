import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IndexStatusBar } from './IndexStatusBar'

const mockFileIndexStatus = vi.fn()
const mockFileIndexReindex = vi.fn()
const mockOnFileIndexProgress = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockOnFileIndexProgress.mockReturnValue(() => {}) // returns unsubscribe fn
  vi.stubGlobal('kordaAPI', {
    fileIndexStatus: mockFileIndexStatus,
    fileIndexReindex: mockFileIndexReindex,
    onFileIndexProgress: mockOnFileIndexProgress,
  })
})

describe('IndexStatusBar', () => {
  it('renders nothing when status is not-configured', async () => {
    mockFileIndexStatus.mockResolvedValue({
      status: 'not-configured', fileCount: 0, lastCrawledMs: null, rootPath: '', crawlError: null,
    })
    const { container } = render(<IndexStatusBar onReindex={mockFileIndexReindex} />)
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
  })

  it('shows file count and relative time when idle', async () => {
    mockFileIndexStatus.mockResolvedValue({
      status: 'idle',
      fileCount: 47823,
      lastCrawledMs: Date.now() - 3 * 60_000, // 3 minutes ago
      rootPath: '\\\\SERVER\\projects',
      crawlError: null,
    })
    render(<IndexStatusBar onReindex={mockFileIndexReindex} />)
    await waitFor(() => {
      expect(screen.getByText(/47,823/)).toBeInTheDocument()
      expect(screen.getByText(/min ago/)).toBeInTheDocument()
    })
  })

  it('shows spinner and live count when crawling', async () => {
    mockFileIndexStatus.mockResolvedValue({
      status: 'crawling', fileCount: 24312, lastCrawledMs: null, rootPath: '\\\\SERVER\\projects', crawlError: null,
    })
    render(<IndexStatusBar onReindex={mockFileIndexReindex} />)
    await waitFor(() => {
      expect(screen.getByText(/indexing/i)).toBeInTheDocument()
      expect(screen.getByText(/24,312/)).toBeInTheDocument()
    })
  })

  it('shows error state with Retry button when status is error', async () => {
    mockFileIndexStatus.mockResolvedValue({
      status: 'error', fileCount: 0, lastCrawledMs: null, rootPath: '\\\\SERVER\\projects', crawlError: 'ENOENT',
    })
    render(<IndexStatusBar onReindex={mockFileIndexReindex} />)
    await waitFor(() => {
      expect(screen.getByText(/unreachable/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })
  })

  it('Retry button calls onReindex', async () => {
    mockFileIndexStatus.mockResolvedValue({
      status: 'error', fileCount: 0, lastCrawledMs: null, rootPath: '\\\\SERVER\\projects', crawlError: 'ENOENT',
    })
    render(<IndexStatusBar onReindex={mockFileIndexReindex} />)
    await waitFor(() => screen.getByRole('button', { name: /retry/i }))
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(mockFileIndexReindex).toHaveBeenCalled()
  })

  it('calls the onFileIndexProgress cleanup function on unmount', async () => {
    const unsubscribeSpy = vi.fn()
    mockOnFileIndexProgress.mockReturnValue(unsubscribeSpy)
    mockFileIndexStatus.mockResolvedValue({
      status: 'idle', fileCount: 10, lastCrawledMs: Date.now(),
      rootPath: '\\\\SERVER\\projects', crawlError: null,
    })
    const { unmount } = render(<IndexStatusBar onReindex={mockFileIndexReindex} />)
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalled())
    unmount()
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1)
  })
})
