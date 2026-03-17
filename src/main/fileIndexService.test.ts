// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock electron before importing the service
vi.mock('electron', () => ({
  shell: {
    openPath: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test'),
  },
}))

// Mock chokidar so init() doesn't start a real watcher
vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    }),
  },
}))

// Mock fs/promises so crawlIfStale doesn't walk real filesystem
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn(),
}))

import { fileIndexService } from './fileIndexService'
import { shell } from 'electron'

describe('fileIndexService — schema creation', () => {
  beforeEach(() => {
    fileIndexService.init(':memory:', () => '', null)
  })
  afterEach(() => {
    fileIndexService.close()
    vi.clearAllMocks()
  })

  it('creates the files table', () => {
    // getStatus() queries index_meta; if schema is missing it would throw
    expect(() => fileIndexService.getStatus()).not.toThrow()
  })

  it('returns not-configured status when root is empty', () => {
    const status = fileIndexService.getStatus()
    expect(status.status).toBe('not-configured')
    expect(status.rootPath).toBe('')
    expect(status.fileCount).toBe(0)
    expect(status.lastCrawledMs).toBeNull()
    expect(status.crawlError).toBeNull()
  })
})

describe('fileIndexService — getStatus with root configured', () => {
  beforeEach(() => {
    fileIndexService.init(':memory:', () => '\\\\SERVER\\projects', null)
  })
  afterEach(() => {
    fileIndexService.close()
    vi.clearAllMocks()
  })

  it('returns idle status with rootPath when root is configured', () => {
    const status = fileIndexService.getStatus()
    expect(status.status).toBe('idle')
    expect(status.rootPath).toBe('\\\\SERVER\\projects')
  })
})

describe('fileIndexService — openFile', () => {
  beforeEach(() => {
    fileIndexService.init(':memory:', () => '', null)
  })
  afterEach(() => {
    fileIndexService.close()
    vi.clearAllMocks()
  })

  it('calls shell.openPath with the given path', async () => {
    vi.mocked(shell.openPath).mockResolvedValue('')
    await fileIndexService.openFile('C:\\projects\\file.pdf')
    expect(shell.openPath).toHaveBeenCalledWith('C:\\projects\\file.pdf')
  })

  it('returns empty string on success', async () => {
    vi.mocked(shell.openPath).mockResolvedValue('')
    const result = await fileIndexService.openFile('C:\\file.pdf')
    expect(result).toBe('')
  })

  it('returns the error string on failure', async () => {
    vi.mocked(shell.openPath).mockResolvedValue('File not found')
    const result = await fileIndexService.openFile('C:\\missing.pdf')
    expect(result).toBe('File not found')
  })
})
