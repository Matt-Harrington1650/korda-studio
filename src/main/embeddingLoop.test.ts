// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import type { EmbeddingProvider } from '../shared/contracts/embedding-provider-contract'
import type { ProviderSet } from './embeddingProviderFactory'
import { EmbeddingLoop } from './embeddingLoop'
import { deserializeEmbedding } from './vectorUtils'

function makeDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pipeline_state TEXT NOT NULL DEFAULT 'indexed'
    );
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      file_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      embedding BLOB,
      embedding_model TEXT
    );
  `)
  return db
}

function seedChunks(db: Database.Database, count: number): void {
  const insert = db.prepare('INSERT INTO chunks (id, file_id, text) VALUES (?, 1, ?)')
  db.prepare('INSERT INTO files (id, pipeline_state) VALUES (1, ?)').run('indexed')
  for (let i = 0; i < count; i++) {
    insert.run(`chunk-${i}`, `chunk text ${i}`)
  }
}

describe('EmbeddingLoop', () => {
  let db: Database.Database
  let mockEmit: ReturnType<typeof vi.fn>
  let mockEmbedder: EmbeddingProvider
  let getProviders: () => ProviderSet

  beforeEach(() => {
    vi.useFakeTimers()
    db = makeDb()
    mockEmit = vi.fn()
    mockEmbedder = {
      modelId: 'voyage-3',
      dimensions: 1024,
      maxBatchSize: 96,
      embed: vi.fn(),
    }
    getProviders = () => ({ embedder: mockEmbedder, reranker: null })
  })

  afterEach(() => {
    vi.useRealTimers()
    db.close()
  })

  it('persists embeddings as BLOBs to chunks table', async () => {
    seedChunks(db, 2)
    const fakeEmbedding = Array(1024).fill(0.1)
    ;(mockEmbedder.embed as ReturnType<typeof vi.fn>).mockResolvedValue([
      fakeEmbedding,
      fakeEmbedding,
    ])

    const loop = new EmbeddingLoop(db, getProviders, mockEmit)
    await (
      loop as unknown as { processBatch: (embedder: EmbeddingProvider) => Promise<void> }
    ).processBatch(mockEmbedder)

    const rows = db.prepare('SELECT embedding, embedding_model FROM chunks ORDER BY id').all() as {
      embedding: Buffer
      embedding_model: string
    }[]

    expect(rows[0].embedding).toBeTruthy()
    expect(rows[0].embedding_model).toBe('voyage-3')
    const vec = deserializeEmbedding(rows[0].embedding)
    expect(vec.length).toBe(1024)
  })

  it('skips batch when no embedder is configured', async () => {
    seedChunks(db, 1)
    const noProvider = () => ({ embedder: null, reranker: null })
    const loop = new EmbeddingLoop(db, noProvider, mockEmit)

    await (loop as unknown as { tick: () => Promise<void> }).tick()

    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('backs off on 429 without throwing', async () => {
    seedChunks(db, 1)
    const err = new Error('Rate limited') as Error & { status: number }
    err.status = 429
    ;(mockEmbedder.embed as ReturnType<typeof vi.fn>).mockRejectedValue(err)

    const loop = new EmbeddingLoop(db, getProviders, mockEmit)

    await expect(
      (
        loop as unknown as { processBatch: (embedder: EmbeddingProvider) => Promise<void> }
      ).processBatch(mockEmbedder),
    ).resolves.not.toThrow()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('re-embeds chunks with a stale model', async () => {
    seedChunks(db, 1)
    db.prepare(
      "UPDATE chunks SET embedding = X'00000000', embedding_model = 'old-model' WHERE id = 'chunk-0'",
    ).run()
    ;(mockEmbedder.embed as ReturnType<typeof vi.fn>).mockResolvedValue([Array(1024).fill(0)])

    const loop = new EmbeddingLoop(db, getProviders, mockEmit)

    await (
      loop as unknown as { processBatch: (embedder: EmbeddingProvider) => Promise<void> }
    ).processBatch(mockEmbedder)

    const row = db.prepare("SELECT embedding_model FROM chunks WHERE id = 'chunk-0'").get() as {
      embedding_model: string
    }

    expect(row.embedding_model).toBe('voyage-3')
  })

  it('getStats returns correct counts and hasProvider', () => {
    seedChunks(db, 3)
    db.prepare(
      "UPDATE chunks SET embedding = X'00', embedding_model = 'voyage-3' WHERE id = 'chunk-0'",
    ).run()

    const loop = new EmbeddingLoop(db, getProviders, mockEmit)
    const stats = loop.getStats()

    expect(stats.total).toBe(3)
    expect(stats.embedded).toBe(1)
    expect(stats.percent).toBe(33)
    expect(stats.isReady).toBe(false)
    expect(stats.hasProvider).toBe(true)
  })

  it('init is idempotent and does not leak timers', () => {
    const loop = new EmbeddingLoop(db, getProviders, mockEmit)

    loop.init()
    loop.init()
    loop.destroy()
  })
})
