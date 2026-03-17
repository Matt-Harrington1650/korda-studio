import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
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

  it('shows success banner after save', async () => {
    render(<Component />)
    fireEvent.change(screen.getByPlaceholderText(/\\\\SERVER\\projects/i), {
      target: { value: 'C:\\projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(screen.getByText(/✓ Saved/i)).toBeInTheDocument()
    )
  })

  it('success banner disappears after 4 seconds', async () => {
    vi.useFakeTimers()
    render(<Component />)
    fireEvent.change(screen.getByPlaceholderText(/\\\\SERVER\\projects/i), {
      target: { value: 'C:\\projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(screen.getByText(/✓ Saved/i)).toBeInTheDocument())
    act(() => { vi.advanceTimersByTime(4_001) })
    expect(screen.queryByText(/✓ Saved/i)).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('shows error message when storeSet rejects', async () => {
    mockStoreSet.mockRejectedValue(new Error('disk full'))
    render(<Component />)
    fireEvent.change(screen.getByPlaceholderText(/\\\\SERVER\\projects/i), {
      target: { value: 'C:\\projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(screen.getByText(/disk full/i)).toBeInTheDocument()
    )
  })

  it('shows error message when fileIndexReindex rejects', async () => {
    mockFileIndexReindex.mockRejectedValue(new Error('IPC failed'))
    render(<Component />)
    fireEvent.change(screen.getByPlaceholderText(/\\\\SERVER\\projects/i), {
      target: { value: 'C:\\projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(screen.getByText(/IPC failed/i)).toBeInTheDocument()
    )
  })

  it('banner and error are mutually exclusive — no error on success', async () => {
    render(<Component />)
    fireEvent.change(screen.getByPlaceholderText(/\\\\SERVER\\projects/i), {
      target: { value: 'C:\\projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(screen.getByText(/✓ Saved/i)).toBeInTheDocument())
    expect(screen.queryByText(/Error:/i)).not.toBeInTheDocument()
  })

  it('Save button shows "Saving…" while IPC in-flight', async () => {
    // Delay resolution so we can observe the in-flight state
    let resolve!: () => void
    mockStoreSet.mockReturnValue(new Promise<void>((r) => { resolve = r }))
    render(<Component />)
    fireEvent.change(screen.getByPlaceholderText(/\\\\SERVER\\projects/i), {
      target: { value: 'C:\\projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    // Use waitFor — React 19 state updates are async and may not flush synchronously after fireEvent
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /saving/i })).toBeInTheDocument()
    )
    resolve()
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument())
  })

  it('Save button is re-enabled after save completes', async () => {
    render(<Component />)
    fireEvent.change(screen.getByPlaceholderText(/\\\\SERVER\\projects/i), {
      target: { value: 'C:\\projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled()
    )
  })

  it('storeSet is called before fileIndexReindex', async () => {
    const callOrder: string[] = []
    mockStoreSet.mockImplementation(async () => { callOrder.push('storeSet') })
    mockFileIndexReindex.mockImplementation(async () => { callOrder.push('reindex') })
    render(<Component />)
    fireEvent.change(screen.getByPlaceholderText(/\\\\SERVER\\projects/i), {
      target: { value: 'C:\\projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(callOrder).toHaveLength(2))
    expect(callOrder).toEqual(['storeSet', 'reindex'])
  })
})
