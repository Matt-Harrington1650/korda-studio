import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SystemStatusModule from './SystemStatusModule'

const mockFileIndexStatus = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockFileIndexStatus.mockResolvedValue({
    status: 'idle',
    fileCount: 5000,
    lastCrawledMs: Date.now(),
    rootPath: '\\\\SERVER\\projects',
    crawlError: null,
  })
  vi.stubGlobal('kordaAPI', {
    fileIndexStatus: mockFileIndexStatus,
  })
})

describe('SystemStatusModule', () => {
  it('shows network connectivity status', async () => {
    render(<SystemStatusModule />)
    await waitFor(() => {
      expect(screen.getByText(/network/i)).toBeInTheDocument()
    })
  })

  it('has a refresh button', () => {
    render(<SystemStatusModule />)
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument()
  })

  it('shows File Server row as Connected when fileIndexStatus returns idle with fileCount > 0', async () => {
    render(<SystemStatusModule />)
    await waitFor(() => {
      expect(screen.getAllByText(/connected/i).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows File Server row as Indexing when status is crawling', async () => {
    mockFileIndexStatus.mockResolvedValue({
      status: 'crawling', fileCount: 100, lastCrawledMs: null, rootPath: '\\\\SERVER\\projects', crawlError: null,
    })
    render(<SystemStatusModule />)
    await waitFor(() => {
      expect(screen.getByText(/indexing/i)).toBeInTheDocument()
    })
  })

  it('shows File Server row as Unreachable when status is error', async () => {
    mockFileIndexStatus.mockResolvedValue({
      status: 'error', fileCount: 0, lastCrawledMs: null, rootPath: '\\\\SERVER\\projects', crawlError: 'ENOENT',
    })
    render(<SystemStatusModule />)
    await waitFor(() => {
      expect(screen.getByText(/unreachable/i)).toBeInTheDocument()
    })
  })

  it('shows File Server row as Not Configured when status is not-configured', async () => {
    mockFileIndexStatus.mockResolvedValue({
      status: 'not-configured', fileCount: 0, lastCrawledMs: null, rootPath: '', crawlError: null,
    })
    render(<SystemStatusModule />)
    await waitFor(() => {
      expect(screen.getAllByText(/not configured/i).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('refresh button re-calls fileIndexStatus', async () => {
    render(<SystemStatusModule />)
    await waitFor(() => screen.getByRole('button', { name: /refresh/i }))
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))
    await waitFor(() => {
      expect(mockFileIndexStatus).toHaveBeenCalledTimes(2) // once on mount, once on refresh
    })
  })

  it('shows skeleton rows on mount before first poll resolves', () => {
    // mockReturnValue (not mockResolvedValue) so the Promise never settles during this test
    mockFileIndexStatus.mockReturnValue(new Promise(() => {}))
    render(<SystemStatusModule />)
    // Skeleton rows use animate-pulse class — visible immediately on mount
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('replaces skeleton rows with real data after first poll resolves', async () => {
    render(<SystemStatusModule />)
    await waitFor(() => {
      expect(document.querySelector('.animate-pulse')).toBeFalsy()
      expect(screen.getByText('File Server')).toBeInTheDocument()
    })
  })
})
