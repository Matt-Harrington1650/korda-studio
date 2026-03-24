// @vitest-environment node
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url))
const WORKER_BUILD_PATH = path.resolve(THIS_DIR, '../../.vite/build/ingestionWorker.js')
const WORKER_VITE_CONFIG = path.resolve(process.cwd(), 'vite.worker.config.ts')

function makeDb(dbPath: string) {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
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
    );
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
    );
    CREATE VIRTUAL TABLE chunks_fts USING fts5(
      text,
      section_title,
      content='chunks',
      content_rowid='rowid',
      tokenize='porter unicode61'
    );
    CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, text, section_title) VALUES (new.rowid, new.text, new.section_title);
    END;
    CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text, section_title)
      VALUES ('delete', old.rowid, old.text, old.section_title);
    END;
    CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text, section_title)
      VALUES ('delete', old.rowid, old.text, old.section_title);
      INSERT INTO chunks_fts(rowid, text, section_title)
      VALUES (new.rowid, new.text, new.section_title);
    END;
  `)
  return db
}

describe('ingestionWorker integration', () => {
  let tmpDir: string
  let dbPath: string
  let db: Database.Database

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'korda-ingestion-worker-'))
    dbPath = path.join(tmpDir, 'test.db')
    db = makeDb(dbPath)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('indexes a txt file end-to-end when ext is stored without a leading dot', async () => {
    await build({
      configFile: WORKER_VITE_CONFIG,
      logLevel: 'silent',
    })

    const txtPath = path.join(tmpDir, 'sample.txt')
    fs.writeFileSync(txtPath, 'This is a sample engineering specification for retrieval testing.')

    const fileId = Number(
      db
        .prepare(
          `INSERT INTO files (path, name, ext, size_bytes, modified_ms, source_id, pipeline_state)
         VALUES (?, ?, ?, ?, ?, ?, 'queued')`,
        )
        .run(txtPath, 'sample.txt', 'txt', 64, Date.now(), 'src1').lastInsertRowid,
    )

    const worker = new Worker(WORKER_BUILD_PATH, {
      workerData: { dbPath },
    })
    let workerError: Error | null = null
    let workerFailedMessage: string | null = null
    let jobPosted = false

    worker.on(
      'message',
      (message: { type: string; fileId?: number; state?: string; error?: string }) => {
        if (message.type === 'ready' && message.fileId == null && !jobPosted) {
          jobPosted = true
          worker.postMessage({
            type: 'job',
            fileId,
            filePath: txtPath,
            sourceId: 'src1',
            ext: 'txt',
          })
          return
        }

        if (
          message.type === 'progress' &&
          message.fileId === fileId &&
          message.state === 'failed'
        ) {
          workerFailedMessage = message.error ?? 'Worker failed'
        }
      },
    )

    worker.on('error', (error) => {
      workerError = error instanceof Error ? error : new Error(String(error))
    })

    try {
      await vi.waitFor(
        () => {
          if (workerError) {
            throw workerError
          }

          if (workerFailedMessage) {
            throw new Error(workerFailedMessage)
          }

          const row = db
            .prepare(`SELECT pipeline_state, pipeline_error FROM files WHERE id = ?`)
            .get(fileId) as {
            pipeline_state: string
            pipeline_error: string | null
          }

          if (row.pipeline_state === 'failed') {
            throw new Error(row.pipeline_error ?? 'Worker failed')
          }

          expect(row.pipeline_state).toBe('indexed')
        },
        {
          timeout: 45_000,
          interval: 50,
        },
      )
    } finally {
      await worker.terminate()
    }

    const fileRow = db
      .prepare(`SELECT pipeline_state, pipeline_error FROM files WHERE id = ?`)
      .get(fileId) as {
      pipeline_state: string
      pipeline_error: string | null
    }
    expect(fileRow.pipeline_state).toBe('indexed')
    expect(fileRow.pipeline_error).toBeNull()

    const chunks = db
      .prepare(`SELECT text, source_id, chunk_index FROM chunks WHERE file_id = ?`)
      .all(fileId) as Array<{
      text: string
      source_id: string
      chunk_index: number
    }>
    expect(chunks).toHaveLength(1)
    expect(chunks[0].source_id).toBe('src1')
    expect(chunks[0].chunk_index).toBe(0)
    expect(chunks[0].text).toContain('sample engineering specification')

    const ftsRow = db
      .prepare(`SELECT COUNT(*) AS count FROM chunks_fts WHERE chunks_fts MATCH 'engineering'`)
      .get() as { count: number }
    expect(ftsRow.count).toBe(1)
  }, 60_000)
})
