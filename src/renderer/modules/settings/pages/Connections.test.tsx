import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Component as Connections } from './Connections'
import type {
  FailedIngestionFile,
  FileSource,
  IngestionStatus,
  SourceStatus,
} from '../../../../shared/ipc-types'

const source1: FileSource = {
  id: 'src-1',
  displayName: 'Main Server',
  path: '\\\\SERVER\\share',
  type: 'network-share',
  enabled: true,
}
const source2: FileSource = {
  id: 'src-2',
  displayName: 'Local Projects',
  path: 'C:\\Projects',
  type: 'local',
  enabled: true,
}
const status1: SourceStatus = {
  sourceId: 'src-1',
  displayName: 'Main Server',
  path: '\\\\SERVER\\share',
  type: 'network-share',
  online: true,
  status: 'idle',
  fileCount: 1234,
  lastCrawledMs: Date.now() - 3600_000,
  crawlError: null,
}

const ingestionStatus1: IngestionStatus = {
  new: 0,
  queued: 12,
  extracting: 0,
  chunking: 0,
  contextualizing: 0,
  indexed: 1204,
  failed: 1,
  skipped: 5,
  total: 1222,
  totalChunks: 24080,
  avgChunksPerFile: 20,
}

const failedFiles1: FailedIngestionFile[] = [
  {
    fileId: 1,
    path: '\\\\SERVER\\share\\spec.pdf',
    name: 'spec.pdf',
    sourceId: 'src-1',
    error: 'Parse error',
    updatedAt: 1_700_000_000_000,
  },
]

beforeEach(() => {
  // Initialize window.kordaAPI with stub functions so vi.spyOn can work
  vi.stubGlobal('kordaAPI', {
    fileIndexSourcesList: vi.fn().mockResolvedValue([source1]),
    fileIndexStatus: vi.fn().mockResolvedValue([status1]),
    fileIndexSourceSave: vi.fn().mockResolvedValue(undefined),
    fileIndexSourceDelete: vi.fn().mockResolvedValue(null),
    fileIndexReindex: vi.fn().mockResolvedValue(undefined),
    ingestionStatus: vi.fn().mockResolvedValue(ingestionStatus1),
    ingestionRetry: vi.fn().mockResolvedValue(undefined),
    ingestionFailedFiles: vi.fn().mockResolvedValue(failedFiles1),
  })
})

describe('Connections page', () => {
  it('renders the list of sources with their display names', async () => {
    vi.spyOn(window.kordaAPI, 'fileIndexSourcesList').mockResolvedValue([source1, source2])
    render(<Connections />)
    expect(await screen.findByText('Main Server')).toBeInTheDocument()
    expect(screen.getByText('Local Projects')).toBeInTheDocument()
    expect(screen.getByText('\\\\SERVER\\share')).toBeInTheDocument()
  })

  it('shows file count from source status', async () => {
    render(<Connections />)
    const matches = await screen.findAllByText(/1,234/)
    expect(matches.length).toBeGreaterThan(0)
  })

  it('delete button calls fileIndexSourceDelete then reloads', async () => {
    render(<Connections />)
    const deleteBtn = await screen.findByRole('button', { name: /delete/i })
    fireEvent.click(deleteBtn)
    await waitFor(() => {
      expect(window.kordaAPI.fileIndexSourceDelete).toHaveBeenCalledWith('src-1')
    })
  })

  it('shows toast when delete returns error string', async () => {
    vi.spyOn(window.kordaAPI, 'fileIndexSourceDelete').mockResolvedValue(
      'Source is currently indexing — please wait',
    )
    render(<Connections />)
    const deleteBtn = await screen.findByRole('button', { name: /delete/i })
    fireEvent.click(deleteBtn)
    expect(await screen.findByText(/currently indexing/i)).toBeInTheDocument()
  })

  it('Reindex All button calls fileIndexReindex with no sourceId', async () => {
    render(<Connections />)
    const btn = await screen.findByRole('button', { name: /reindex all/i })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(window.kordaAPI.fileIndexReindex).toHaveBeenCalledWith(undefined)
    })
  })

  it('shows per-source ingestion counts and retries failed files', async () => {
    render(<Connections />)

    expect(await screen.findByText(/1,204 indexed/i)).toBeInTheDocument()
    expect(screen.getByText(/12 queued/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /retry failed/i }))

    await waitFor(() => {
      expect(window.kordaAPI.ingestionRetry).toHaveBeenCalledWith('src-1')
    })
  })

  it('expands failed file details for a source', async () => {
    render(<Connections />)

    fireEvent.click(await screen.findByRole('button', { name: /1 failed/i }))

    expect(await screen.findByText('spec.pdf')).toBeInTheDocument()
    expect(screen.getByText(/parse error/i)).toBeInTheDocument()
    expect(window.kordaAPI.ingestionFailedFiles).toHaveBeenCalledWith('src-1')
  })
})
