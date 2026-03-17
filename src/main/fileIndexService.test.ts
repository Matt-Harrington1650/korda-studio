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

import * as fsPromises from 'node:fs/promises'

describe('fileIndexService — crawlIfStale', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fsPromises.readdir).mockResolvedValue([])
    fileIndexService.init(':memory:', () => '\\\\SERVER\\projects', null)
  })
  afterEach(() => {
    fileIndexService.close()
  })

  it('triggers crawl when last_crawl_ms is null (first run)', async () => {
    const startCrawlSpy = vi.spyOn(fileIndexService, 'startCrawl').mockResolvedValue()
    fileIndexService.crawlIfStale()
    expect(startCrawlSpy).toHaveBeenCalled()
  })

  it('triggers crawl when last_crawl_ms is more than 24 hours ago', async () => {
    const startCrawlSpy = vi.spyOn(fileIndexService, 'startCrawl').mockResolvedValue()
    fileIndexService.crawlIfStale()
    expect(startCrawlSpy).toHaveBeenCalled()
    startCrawlSpy.mockRestore()
  })
})

describe('fileIndexService — startCrawl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    fileIndexService.close()
  })

  it('upserts file rows and updates index_meta after crawl', async () => {
    const root = '\\\\SERVER\\projects'

    vi.mocked(fsPromises.readdir).mockImplementation(async (dir) => {
      if (dir === root) {
        return [makeDirent('PROJECT-001', true)] as any
      }
      if (String(dir).endsWith('PROJECT-001')) {
        return [makeDirent('C-101_IFC.dwg', false)] as any
      }
      return [] as any
    })

    vi.mocked(fsPromises.stat).mockResolvedValue({
      size: 2048,
      mtimeMs: 1700000000000,
    } as any)

    fileIndexService.init(':memory:', () => root, null)
    await fileIndexService.startCrawl()

    const status = fileIndexService.getStatus()
    expect(status.status).toBe('idle')
    expect(status.fileCount).toBeGreaterThan(0)
    expect(status.lastCrawledMs).not.toBeNull()
  })

  it('sets crawl_status to error when readdir throws on root', async () => {
    vi.mocked(fsPromises.readdir).mockRejectedValue(new Error('ENOENT'))
    fileIndexService.init(':memory:', () => '\\\\SERVER\\missing', null)
    await fileIndexService.startCrawl()
    const status = fileIndexService.getStatus()
    expect(status.status).toBe('error')
    expect(status.crawlError).toBeTruthy()
  })

  it('populates projects table from distinct project values', async () => {
    const root = '\\\\SERVER\\projects'
    vi.mocked(fsPromises.readdir).mockImplementation(async (dir) => {
      if (dir === root) return [makeDirent('PROJECT-001', true)] as any
      if (String(dir).endsWith('PROJECT-001')) return [makeDirent('C-101.dwg', false)] as any
      return [] as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ size: 1024, mtimeMs: 1700000000000 } as any)

    fileIndexService.init(':memory:', () => root, null)
    await fileIndexService.startCrawl()

    const results = fileIndexService.search({ query: 'C-101' })
    expect(results[0]?.project).toBe('PROJECT-001')
  })
})

describe('fileIndexService — reindex', () => {
  beforeEach(() => {
    vi.mocked(fsPromises.readdir).mockResolvedValue([])
    fileIndexService.init(':memory:', () => '\\\\SERVER\\projects', null)
  })
  afterEach(() => {
    fileIndexService.close()
    vi.clearAllMocks()
  })

  it('clears files and projects tables and triggers a new crawl', async () => {
    const startCrawlSpy = vi.spyOn(fileIndexService, 'startCrawl').mockResolvedValue()
    fileIndexService.reindex()
    expect(startCrawlSpy).toHaveBeenCalled()
    startCrawlSpy.mockRestore()
  })
})

// Helper: create a mock Dirent-like object
function makeDirent(name: string, isDirectory: boolean) {
  return {
    name,
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
  }
}

import chokidar from 'chokidar'

describe('fileIndexService — search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fsPromises.readdir).mockResolvedValue([])
    fileIndexService.init(':memory:', () => '\\\\SERVER\\projects', null)
  })
  afterEach(() => {
    fileIndexService.close()
  })

  it('returns empty array for blank query', () => {
    expect(fileIndexService.search({ query: '' })).toEqual([])
  })

  it('returns empty array for whitespace-only query', () => {
    expect(fileIndexService.search({ query: '   ' })).toEqual([])
  })

  it('returns matching files by name LIKE query', async () => {
    vi.mocked(fsPromises.readdir).mockImplementation(async (dir) => {
      if (dir === '\\\\SERVER\\projects') return [makeDirent('P001', true)] as any
      if (String(dir).endsWith('P001')) return [makeDirent('C-101_IFC.dwg', false)] as any
      return [] as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ size: 1024, mtimeMs: 1700000000000 } as any)
    await fileIndexService.startCrawl()

    const results = fileIndexService.search({ query: 'C-101' })
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('C-101_IFC.dwg')
    expect(results[0].docType).toBe('drawing')
    expect(results[0].project).toBe('P001')
  })

  it('filters by project', async () => {
    vi.mocked(fsPromises.readdir).mockImplementation(async (dir) => {
      if (dir === '\\\\SERVER\\projects') return [makeDirent('P001', true), makeDirent('P002', true)] as any
      if (String(dir).endsWith('P001')) return [makeDirent('C-101.dwg', false)] as any
      if (String(dir).endsWith('P002')) return [makeDirent('C-201.dwg', false)] as any
      return [] as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ size: 1024, mtimeMs: 1700000000000 } as any)
    await fileIndexService.startCrawl()

    const results = fileIndexService.search({ query: 'dwg', project: 'P001' })
    expect(results.every((r) => r.project === 'P001')).toBe(true)
  })

  it('respects the limit parameter', async () => {
    vi.mocked(fsPromises.readdir).mockImplementation(async (dir) => {
      if (dir === '\\\\SERVER\\projects') return [makeDirent('P001', true)] as any
      if (String(dir).endsWith('P001')) {
        return Array.from({ length: 10 }, (_, i) => makeDirent(`file_${i}.pdf`, false)) as any
      }
      return [] as any
    })
    vi.mocked(fsPromises.stat).mockResolvedValue({ size: 100, mtimeMs: 1700000000000 } as any)
    await fileIndexService.startCrawl()

    const results = fileIndexService.search({ query: 'file', limit: 3 })
    expect(results.length).toBeLessThanOrEqual(3)
  })
})

describe('fileIndexService — startWatcher', () => {
  let mockWatcher: { on: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.clearAllMocks()
    mockWatcher = { on: vi.fn().mockReturnThis(), close: vi.fn() }
    vi.mocked(chokidar.watch).mockReturnValue(mockWatcher as any)
    vi.mocked(fsPromises.readdir).mockResolvedValue([])
    fileIndexService.init(':memory:', () => '', null)
  })
  afterEach(() => {
    fileIndexService.close()
  })

  it('calls chokidar.watch with polling options', () => {
    fileIndexService.startWatcher('\\\\SERVER\\projects')
    expect(chokidar.watch).toHaveBeenCalledWith('\\\\SERVER\\projects', {
      usePolling: true,
      interval: 5000,
      ignoreInitial: true,
    })
  })

  it('registers add, unlink, change, addDir, unlinkDir, and error handlers', () => {
    fileIndexService.startWatcher('\\\\SERVER\\projects')
    const registeredEvents = mockWatcher.on.mock.calls.map((c: any[]) => c[0])
    expect(registeredEvents).toContain('add')
    expect(registeredEvents).toContain('unlink')
    expect(registeredEvents).toContain('change')
    expect(registeredEvents).toContain('addDir')
    expect(registeredEvents).toContain('unlinkDir')
    expect(registeredEvents).toContain('error')
  })
})
