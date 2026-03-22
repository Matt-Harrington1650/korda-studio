import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RetrievalService } from './retrievalService'

function buildTestDb() {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      ext TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      modified_ms INTEGER NOT NULL DEFAULT 0,
      is_dir INTEGER NOT NULL DEFAULT 0,
      source_id TEXT,
      project TEXT,
      discipline TEXT,
      doc_type TEXT,
      drawing_number TEXT,
      revision TEXT,
      issue_status TEXT,
      pipeline_state TEXT NOT NULL DEFAULT 'indexed',
      pipeline_error TEXT,
      pipeline_updated_at INTEGER,
      page_count INTEGER
    )
  `)
  db.exec(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
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
  db.exec(`
    CREATE VIRTUAL TABLE chunks_fts USING fts5(
      text, section_title,
      content='chunks', content_rowid='rowid',
      tokenize='porter unicode61'
    )
  `)
  db.exec(`
    CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, text, section_title) VALUES (new.rowid, new.text, new.section_title);
    END
  `)
  db.exec(`
    CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text, section_title)
      VALUES ('delete', old.rowid, old.text, old.section_title);
    END
  `)
  db.exec(`
    CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text, section_title)
      VALUES ('delete', old.rowid, old.text, old.section_title);
      INSERT INTO chunks_fts(rowid, text, section_title)
      VALUES (new.rowid, new.text, new.section_title);
    END
  `)
  return db
}

describe('RetrievalService', () => {
  let db: Database.Database
  let service: RetrievalService

  beforeEach(() => {
    db = buildTestDb()
    service = new RetrievalService(db)

    const now = Date.now()
    const fileId = db
      .prepare(
        `INSERT INTO files (path, name, ext, size_bytes, modified_ms, source_id, project, pipeline_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'indexed')`,
      )
      .run('/docs/spec.pdf', 'spec.pdf', 'pdf', 1000, now, 'src1', 'PROJ-001')
      .lastInsertRowid as number

    db.prepare(
      `
      INSERT INTO chunks (id, file_id, source_id, chunk_index, text, token_count, char_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run('chunk-1', fileId, 'src1', 0, 'fire rated corridor assembly requirements', 10, 40, now)

    db.prepare(
      `
      INSERT INTO chunks (id, file_id, source_id, chunk_index, text, token_count, char_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      'chunk-2',
      fileId,
      'src1',
      1,
      'corridor assembly details and material schedule',
      10,
      45,
      now,
    )
  })

  afterEach(() => {
    db.close()
  })

  it('returns results for a matching keyword query', async () => {
    const results = await service.search({ query: 'fire rated' })

    expect(results).toHaveLength(1)
    expect(results[0].chunk.id).toBe('chunk-1')
    expect(results[0].file.name).toBe('spec.pdf')
  })

  it('returns empty for non-matching query', async () => {
    const results = await service.search({ query: 'elephant' })

    expect(results).toHaveLength(0)
  })

  it('respects sourceId filter', async () => {
    const results = await service.search({ query: 'fire', sourceId: 'other-src' })

    expect(results).toHaveLength(0)
  })

  it('isVectorReady returns false in Phase 3A', () => {
    expect(service.isVectorReady()).toBe(false)
  })

  it('vector and hybrid modes fall back to keyword', async () => {
    const keyword = await service.search({ query: 'fire', mode: 'keyword' })
    const vector = await service.search({ query: 'fire', mode: 'vector' })
    const hybrid = await service.search({ query: 'fire', mode: 'hybrid' })

    expect(vector).toEqual(keyword)
    expect(hybrid).toEqual(keyword)
  })

  it('highlight contains <mark> tags', async () => {
    const results = await service.search({ query: 'fire' })

    expect(results[0].highlight).toContain('<mark>')
  })

  it('returns adjacent chunks for preview navigation', () => {
    const adjacent = service.getAdjacentChunks(1, 0)

    expect(adjacent.prev).toBeNull()
    expect(adjacent.next?.id).toBe('chunk-2')
  })

  it('reports ingestion status summary', () => {
    const status = service.getStatus()

    expect(status.indexed).toBe(1)
    expect(status.total).toBe(1)
    expect(status.totalChunks).toBe(2)
    expect(status.avgChunksPerFile).toBe(2)
  })
})
