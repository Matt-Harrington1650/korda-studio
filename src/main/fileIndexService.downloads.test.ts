// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'

vi.mock('electron', () => ({
  shell: { openPath: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue('/tmp/test') },
}))

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    }),
  },
}))

// node:fs/promises is NOT mocked — real filesystem access required

import { fileIndexService } from './fileIndexService'
import type { BrowserWindow } from 'electron'

const DOWNLOADS = 'C:\\Users\\mharrington\\Downloads'
const tempDbPath = path.join(os.tmpdir(), `korda-debug-${Date.now()}.db`)
const mockWin = { webContents: { send: vi.fn() } } as unknown as BrowserWindow

describe.skipIf(!!process.env.CI)('fileIndexService — Downloads integration', () => {
  beforeAll(async () => {
    fileIndexService.init(tempDbPath, () => DOWNLOADS, mockWin)
    await fileIndexService.startCrawl()
  }, 60_000)

  afterAll(async () => {
    fileIndexService.close()
    const { unlink } = await import('node:fs/promises')
    for (const suffix of ['', '-wal', '-shm']) {
      await unlink(tempDbPath + suffix).catch(() => {})
    }
  })

  it('rootPath is the Downloads folder', () => {
    const status = fileIndexService.getStatus()
    expect(status.rootPath).toBe(DOWNLOADS)
  })

  it('crawl completed without error — status is idle', () => {
    const status = fileIndexService.getStatus()
    expect(status.status).toBe('idle')
  })

  it('file_count > 0 — at least one file was indexed', () => {
    const status = fileIndexService.getStatus()
    expect(status.fileCount).toBeGreaterThan(0)
  })

  it('progress events were emitted during crawl', () => {
    expect(mockWin.webContents.send).toHaveBeenCalled()
  })
})
