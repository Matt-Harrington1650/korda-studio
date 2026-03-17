import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ProjectsModule from './ProjectsModule'

const mockFileIndexSearch = vi.fn()
const mockFileIndexStatus = vi.fn()
const mockFileIndexOpen = vi.fn()
const mockFileIndexReindex = vi.fn()
const mockOnFileIndexProgress = vi.fn().mockReturnValue(() => {})

beforeEach(() => {
  vi.clearAllMocks()
  mockFileIndexStatus.mockResolvedValue({
    status: 'idle',
    fileCount: 1000,
    lastCrawledMs: Date.now(),
    rootPath: '\\\\SERVER\\projects',
    crawlError: null,
  })
  mockFileIndexSearch.mockResolvedValue([])
  vi.stubGlobal('kordaAPI', {
    fileIndexSearch: mockFileIndexSearch,
    fileIndexStatus: mockFileIndexStatus,
    fileIndexOpen: mockFileIndexOpen,
    fileIndexReindex: mockFileIndexReindex,
    onFileIndexProgress: mockOnFileIndexProgress,
  })
})

describe('ProjectsModule', () => {
  it('renders a search input', () => {
    render(<ProjectsModule />)
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
  })

  it('shows "Search for files" empty state when query is blank', async () => {
    render(<ProjectsModule />)
    await waitFor(() => {
      expect(screen.getByText(/search for files/i)).toBeInTheDocument()
    })
  })

  it('shows "not configured" empty state when root is not configured', async () => {
    mockFileIndexStatus.mockResolvedValue({
      status: 'not-configured', fileCount: 0, lastCrawledMs: null, rootPath: '', crawlError: null,
    })
    render(<ProjectsModule />)
    await waitFor(() => {
      expect(screen.getByText(/file server not configured/i)).toBeInTheDocument()
    })
  })

  it('calls fileIndexSearch after 150ms debounce when user types', async () => {
    vi.useFakeTimers()
    render(<ProjectsModule />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'C-101' } })
    expect(mockFileIndexSearch).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(200) })
    await waitFor(() => expect(mockFileIndexSearch).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'C-101' })
    ))
    vi.useRealTimers()
  })

  it('renders file results returned by fileIndexSearch', async () => {
    mockFileIndexSearch.mockResolvedValue([
      {
        path: '\\\\SERVER\\projects\\P001\\C-101_IFC.dwg',
        name: 'C-101_IFC.dwg',
        ext: 'dwg',
        sizeBytes: 2048,
        modifiedMs: Date.now(),
        isDir: false,
        project: 'P001',
        discipline: null,
        docType: 'drawing',
        drawingNumber: 'C-101',
        revision: null,
        issueStatus: 'IFC',
      },
    ])
    vi.useFakeTimers()
    render(<ProjectsModule />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'C-101' } })
    act(() => { vi.advanceTimersByTime(200) })
    await waitFor(() => {
      expect(screen.getByText('C-101_IFC.dwg')).toBeInTheDocument()
    })
    vi.useRealTimers()
  })

  it('clicking a file row calls fileIndexOpen', async () => {
    mockFileIndexOpen.mockResolvedValue('')
    mockFileIndexSearch.mockResolvedValue([
      {
        path: '\\\\SERVER\\P001\\C-101.dwg', name: 'C-101.dwg', ext: 'dwg',
        sizeBytes: 1024, modifiedMs: Date.now(), isDir: false,
        project: 'P001', discipline: null, docType: 'drawing',
        drawingNumber: 'C-101', revision: null, issueStatus: null,
      },
    ])
    vi.useFakeTimers()
    render(<ProjectsModule />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'C-101' } })
    act(() => { vi.advanceTimersByTime(200) })
    await waitFor(() => screen.getByText('C-101.dwg'))
    fireEvent.click(screen.getByText('C-101.dwg'))
    await waitFor(() => expect(mockFileIndexOpen).toHaveBeenCalledWith('\\\\SERVER\\P001\\C-101.dwg'))
    vi.useRealTimers()
  })
})
