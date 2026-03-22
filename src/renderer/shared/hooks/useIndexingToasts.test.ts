import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useIndexingToasts } from './useIndexingToasts'
import { useToastStore } from '@shared/state/toastStore'

const mockFileIndexStatus = vi.fn()
const mockOnFileIndexProgress = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  // Clear toast store between tests
  useToastStore.setState({ toasts: [] })
  vi.stubGlobal('kordaAPI', {
    fileIndexStatus: mockFileIndexStatus,
    onFileIndexProgress: mockOnFileIndexProgress,
  })
  mockOnFileIndexProgress.mockReturnValue(() => {}) // returns unsubscribe fn
})

afterEach(() => {
  vi.useRealTimers()
})

function makeStatus(status: string, fileCount = 0) {
  // Returns SourceStatus[] (fileIndexStatus now returns an array)
  return [
    {
      sourceId: 'src-1',
      displayName: 'Main Server',
      path: '\\\\SERVER\\share',
      type: 'network-share',
      online: true,
      status,
      fileCount,
      lastCrawledMs: null,
      crawlError: null,
    },
  ]
}

describe('useIndexingToasts', () => {
  it('fires info toast "Indexing started" when first progress event arrives after idle baseline', async () => {
    mockFileIndexStatus.mockResolvedValue(makeStatus('idle'))
    let progressCb!: (count: number) => void
    mockOnFileIndexProgress.mockImplementation((cb: (count: number) => void) => {
      progressCb = cb
      return () => {}
    })

    renderHook(() => useIndexingToasts())

    // Wait for mount baseline poll to complete
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(1))

    // Simulate progress event
    act(() => {
      progressCb(100)
    })

    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].title).toMatch(/indexing started/i)
    expect(toasts[0].type).toBe('info')
  })

  it('does not fire info toast twice for the same crawl', async () => {
    mockFileIndexStatus.mockResolvedValue(makeStatus('idle'))
    let progressCb!: (count: number) => void
    mockOnFileIndexProgress.mockImplementation((cb: (count: number) => void) => {
      progressCb = cb
      return () => {}
    })

    renderHook(() => useIndexingToasts())
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(1))

    act(() => {
      progressCb(100)
    })
    act(() => {
      progressCb(200)
    }) // second event in same crawl

    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1) // only one toast
  })

  it('fires success toast "Index ready" when crawling→idle transition detected', async () => {
    // First poll: crawling
    mockFileIndexStatus
      .mockResolvedValueOnce(makeStatus('crawling', 0)) // baseline on mount
      .mockResolvedValueOnce(makeStatus('idle', 42)) // first poll interval

    mockOnFileIndexProgress.mockReturnValue(() => {})

    renderHook(() => useIndexingToasts())
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(1))

    // Advance 5s to trigger the poll interval
    await act(async () => {
      vi.advanceTimersByTime(5_001)
    })
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(2))

    const toasts = useToastStore.getState().toasts
    const successToast = toasts.find((t) => t.type === 'success')
    expect(successToast).toBeDefined()
    expect(successToast!.title).toMatch(/index ready/i)
    expect(successToast!.title).toContain('42')
  })

  it('does not fire any toast when baseline is already idle on mount', async () => {
    mockFileIndexStatus.mockResolvedValue(makeStatus('idle', 100))
    mockOnFileIndexProgress.mockReturnValue(() => {})

    renderHook(() => useIndexingToasts())
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(1))

    // Advance 5s — no crawling→idle transition
    await act(async () => {
      vi.advanceTimersByTime(5_001)
    })
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(2))

    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('resets crawlToastFired after crawling→idle so second crawl can fire again', async () => {
    mockFileIndexStatus
      .mockResolvedValueOnce(makeStatus('idle')) // baseline
      .mockResolvedValueOnce(makeStatus('idle', 10)) // first poll — no transition

    let progressCb!: (count: number) => void
    mockOnFileIndexProgress.mockImplementation((cb: (count: number) => void) => {
      progressCb = cb
      return () => {}
    })

    renderHook(() => useIndexingToasts())
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(1))

    // First crawl: progress event → toast fires
    act(() => {
      progressCb(50)
    })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    // Simulate crawling→idle transition.
    // NOTE: The mock queue still has 'idle/10' from line 109 (never consumed since no
    // advance happened between mount and here). So we must enqueue crawling + idle
    // AFTER that pending mock, meaning we need three interval ticks total:
    //   tick 1 → idle/10 (no transition)
    //   tick 2 → crawling/50 (idle→crawling; prevStatusRef = 'crawling')
    //   tick 3 → idle/50 (crawling→idle; fire success toast)
    useToastStore.setState({ toasts: [] }) // clear store for clean assertion
    mockFileIndexStatus
      .mockResolvedValueOnce(makeStatus('crawling', 50))
      .mockResolvedValueOnce(makeStatus('idle', 50))
    // Tick 1: consumes the pre-queued 'idle/10' response — no transition
    await act(async () => {
      vi.advanceTimersByTime(5_001)
    })
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(2))
    // Tick 2: crawling → prevStatusRef = 'crawling'
    await act(async () => {
      vi.advanceTimersByTime(5_001)
    })
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(3))
    // Tick 3: idle → detects crawling→idle, fires success toast
    await act(async () => {
      vi.advanceTimersByTime(5_001)
    })
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts
      expect(toasts.some((t) => t.type === 'success')).toBe(true)
    })

    // After reset, a second progress event should fire info toast again
    useToastStore.setState({ toasts: [] })
    act(() => {
      progressCb(10)
    })
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.type === 'info')).toBe(true),
    )
  })

  it('cleans up onFileIndexProgress subscription and poll interval on unmount', async () => {
    const unsubscribeSpy = vi.fn()
    mockOnFileIndexProgress.mockReturnValue(unsubscribeSpy)
    mockFileIndexStatus.mockResolvedValue(makeStatus('idle'))

    const { unmount } = renderHook(() => useIndexingToasts())
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(1))
    unmount()

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1)
    // Advance time — no more fileIndexStatus calls after unmount
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(mockFileIndexStatus).toHaveBeenCalledTimes(1) // still just 1 (baseline only)
  })
})
