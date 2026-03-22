// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const workerState = vi.hoisted(() => {
  return {
    workers: [] as Array<{
      postMessage: ReturnType<typeof vi.fn>
      emit: (event: string, data: unknown) => boolean
    }>,
  }
})

vi.mock('worker_threads', async () => {
  const { EventEmitter } = await import('node:events')

  class MockWorker extends EventEmitter {
    postMessage = vi.fn()
    terminate = vi.fn()

    constructor(..._args: unknown[]) {
      super()
      workerState.workers.push(this)
    }
  }

  return { Worker: MockWorker }
})

import { IngestionQueue } from './ingestionQueue'

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      ext TEXT DEFAULT '',
      size_bytes INTEGER DEFAULT 0,
      modified_ms INTEGER DEFAULT 0,
      source_id TEXT DEFAULT 'src1',
      pipeline_state TEXT NOT NULL DEFAULT 'new',
      pipeline_error TEXT,
      pipeline_updated_at INTEGER,
      page_count INTEGER
    )
  `)
  db.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      file_id INTEGER NOT NULL,
      source_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      char_count INTEGER NOT NULL,
      page_number INTEGER,
      section_title TEXT,
      sheet_name TEXT,
      embedding BLOB,
      created_at INTEGER NOT NULL,
      UNIQUE(file_id, chunk_index)
    )
  `)
  return db
}

describe('IngestionQueue', () => {
  let db: Database.Database
  let queue: IngestionQueue

  beforeEach(() => {
    workerState.workers.length = 0
    db = makeDb()
    queue = new IngestionQueue(db, '/fake/db.db', () => {}, 2)
  })

  afterEach(() => {
    queue.stop()
    db.close()
  })

  it('drainNew moves new files to queued state', () => {
    db.prepare(`INSERT INTO files (path, name) VALUES (?, ?)`).run('/a/b.pdf', 'b.pdf')

    queue.drainNew()

    const row = db.prepare(`SELECT pipeline_state FROM files WHERE name = 'b.pdf'`).get() as {
      pipeline_state: string
    }
    expect(row.pipeline_state).toBe('queued')
  })

  it('dispatches queued work when a worker becomes ready', () => {
    const fileId = Number(
      db
        .prepare(
          `INSERT INTO files (path, name, ext, source_id, pipeline_state)
         VALUES (?, ?, ?, ?, 'queued')`,
        )
        .run('/docs/spec.txt', 'spec.txt', 'txt', 'src1').lastInsertRowid,
    )

    queue.init()

    const worker = workerState.workers[0]
    worker.emit('message', { type: 'ready' })

    expect(worker.postMessage).toHaveBeenCalledWith({
      type: 'job',
      fileId,
      filePath: '/docs/spec.txt',
      sourceId: 'src1',
      ext: 'txt',
    })

    const row = db.prepare(`SELECT pipeline_state FROM files WHERE id = ?`).get(fileId) as {
      pipeline_state: string
    }
    expect(row.pipeline_state).toBe('extracting')
  })

  it('retry resets failed files to new', () => {
    db.prepare(`INSERT INTO files (path, name, pipeline_state) VALUES (?, ?, 'failed')`).run(
      '/x.pdf',
      'x.pdf',
    )

    queue.retry()

    const row = db
      .prepare(`SELECT pipeline_state, pipeline_error FROM files WHERE name = 'x.pdf'`)
      .get() as {
      pipeline_state: string
      pipeline_error: string | null
    }
    expect(row.pipeline_state).toBe('queued')
    expect(row.pipeline_error).toBeNull()
  })

  it('getStatus returns counts per pipeline state and chunk totals', () => {
    const indexedId = Number(
      db
        .prepare(
          `INSERT INTO files (path, name, pipeline_state, source_id) VALUES (?, ?, 'indexed', ?)`,
        )
        .run('/a.pdf', 'a.pdf', 'src1').lastInsertRowid,
    )
    db.prepare(
      `INSERT INTO files (path, name, pipeline_state, source_id) VALUES (?, ?, 'failed', ?)`,
    ).run('/b.pdf', 'b.pdf', 'src1')
    db.prepare(
      `INSERT INTO chunks (id, file_id, source_id, chunk_index, text, token_count, char_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('chunk-1', indexedId, 'src1', 0, 'fire rated wall', 4, 16, Date.now())

    const status = queue.getStatus()

    expect(status.indexed).toBe(1)
    expect(status.failed).toBe(1)
    expect(status.total).toBe(2)
    expect(status.totalChunks).toBe(1)
    expect(status.avgChunksPerFile).toBe(1)
  })
})
