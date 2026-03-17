// @vitest-environment node
// Integration test: real fs crawl against a local path (no mocks on fs/promises)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as path from 'node:path'

// Mock only electron — shell.openPath not needed for crawl
vi.mock('electron', () => ({
  shell: { openPath: vi.fn().mockResolvedValue('') },
  app: { getPath: vi.fn().mockReturnValue('/tmp/test') },
}))

// Mock chokidar so the watcher doesn't start against a real directory in tests
vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    }),
  },
}))

// DO NOT mock node:fs/promises — we want real filesystem access

import { fileIndexService } from './fileIndexService'

const LOCAL_ROOT = path.resolve(__dirname, '__testdata__/projects')

describe('fileIndexService — local path crawl (real fs)', () => {
  beforeEach(() => {
    fileIndexService.init(':memory:', () => LOCAL_ROOT, null)
  })
  afterEach(() => {
    fileIndexService.close()
  })

  it('crawls a real local directory and indexes files', async () => {
    await fileIndexService.startCrawl()

    const status = fileIndexService.getStatus()
    expect(status.status).toBe('idle')
    expect(status.fileCount).toBe(4) // 4 files across 2 project folders
    expect(status.lastCrawledMs).not.toBeNull()
    expect(status.rootPath).toBe(LOCAL_ROOT)
  })

  it('finds a drawing by name', async () => {
    await fileIndexService.startCrawl()
    const results = fileIndexService.search({ query: 'C-101' })
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('C-101_IFC_Rev_A.dwg')
    expect(results[0].docType).toBe('drawing')
    expect(results[0].drawingNumber).toBe('C-101')
    expect(results[0].issueStatus).toBe('IFC')
    expect(results[0].revision).toBe('A')
  })

  it('finds a calculation by name', async () => {
    await fileIndexService.startCrawl()
    const results = fileIndexService.search({ query: 'Footing' })
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Footing_Calc_Rev2.xlsx')
    expect(results[0].docType).toBe('calculation')
    expect(results[0].project).toBe('PROJ-002')
  })

  it('finds a report', async () => {
    await fileIndexService.startCrawl()
    const results = fileIndexService.search({ query: 'Geotech' })
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Geotech_Report_Final.pdf')
    expect(results[0].docType).toBe('report')
    expect(results[0].revision).toBe('FINAL')
  })

  it('assigns correct project from top-level folder name', async () => {
    await fileIndexService.startCrawl()
    const proj001 = fileIndexService.search({ query: 'C-101' })
    expect(proj001[0].project).toBe('PROJ-001')

    const proj002 = fileIndexService.search({ query: 'Footing' })
    expect(proj002[0].project).toBe('PROJ-002')
  })

  it('filters search results by project', async () => {
    await fileIndexService.startCrawl()
    const results = fileIndexService.search({ query: 'pdf', project: 'PROJ-001' })
    expect(results.every(r => r.project === 'PROJ-001')).toBe(true)
  })

  it('getStatus returns not-configured when root is empty string', () => {
    fileIndexService.close()
    fileIndexService.init(':memory:', () => '', null)
    expect(fileIndexService.getStatus().status).toBe('not-configured')
  })
})
