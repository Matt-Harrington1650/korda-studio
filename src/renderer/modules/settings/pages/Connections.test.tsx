import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Component } from './Connections'

const mockStoreSet = vi.fn()
const mockFileIndexReindex = vi.fn()
const mockFileIndexStatus = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockFileIndexStatus.mockResolvedValue({
    status: 'idle',
    fileCount: 1234,
    lastCrawledMs: Date.now() - 120_000, // 2 minutes ago
    rootPath: '',
    crawlError: null,
  })
  vi.stubGlobal('kordaAPI', {
    storeGet: vi.fn().mockResolvedValue(null),
    storeSet: mockStoreSet.mockResolvedValue(undefined),
    fileIndexReindex: mockFileIndexReindex.mockResolvedValue(undefined),
    fileIndexStatus: mockFileIndexStatus,
  })
})

describe('Connections page', () => {
  it('renders the File Server section with a root path input', () => {
    render(<Component />)
    expect(screen.getByText('File Server')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/\\\\SERVER\\projects/i)).toBeInTheDocument()
  })

  it('Save button is disabled when input is empty', () => {
    render(<Component />)
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('Save button is enabled when input has a value', async () => {
    render(<Component />)
    const input = screen.getByPlaceholderText(/\\\\SERVER\\projects/i)
    fireEvent.change(input, { target: { value: '\\\\SERVER\\projects' } })
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled()
  })

  it('Save calls storeSet with connections JSON and then fileIndexReindex', async () => {
    render(<Component />)
    const input = screen.getByPlaceholderText(/\\\\SERVER\\projects/i)
    fireEvent.change(input, { target: { value: '\\\\SERVER\\projects' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(mockStoreSet).toHaveBeenCalledWith(
        'connections',
        JSON.stringify({ fileServerRoot: '\\\\SERVER\\projects' }),
      )
      expect(mockFileIndexReindex).toHaveBeenCalled()
    })
  })

  it('shows file count and last crawled time from fileIndexStatus', async () => {
    render(<Component />)
    await waitFor(() => {
      expect(screen.getByText(/1,234/)).toBeInTheDocument()
    })
  })

  it('Re-index button calls fileIndexReindex', async () => {
    render(<Component />)
    await waitFor(() => screen.getByRole('button', { name: /re.?index/i }))
    fireEvent.click(screen.getByRole('button', { name: /re.?index/i }))
    await waitFor(() => expect(mockFileIndexReindex).toHaveBeenCalled())
  })
})
