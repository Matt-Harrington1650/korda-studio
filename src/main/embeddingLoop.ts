import type Database from 'better-sqlite3'
import type {
  EmbeddingProvider,
  EmbeddingStats,
} from '../shared/contracts/embedding-provider-contract'
import type { EmbeddingProgressPayload } from '../shared/ipc-types'
import type { ProviderSet } from './embeddingProviderFactory'
import { normalizeVector, serializeEmbedding } from './vectorUtils'

const BATCH_SIZE = 32
const INITIAL_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 60_000

interface PendingChunkRow {
  id: string
  text: string
}

export class EmbeddingLoop {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private retryDelayMs = INITIAL_BACKOFF_MS
  private nextRetryAt = 0

  constructor(
    private readonly db: Database.Database,
    private readonly getProviders: () => ProviderSet,
    private readonly emit: (payload: EmbeddingProgressPayload) => void,
  ) {}

  init(): void {
    this.destroy()
    this.timer = setInterval(() => {
      void this.tick()
    }, 10_000)
    setImmediate(() => {
      void this.tick()
    })
  }

  destroy(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getStats(): EmbeddingStats {
    const { embedder } = this.getProviders()
    const totalRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM chunks c
         JOIN files f ON f.id = c.file_id
         WHERE f.pipeline_state = 'indexed'`,
      )
      .get() as { count: number }
    const embeddedRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM chunks c
         JOIN files f ON f.id = c.file_id
         WHERE f.pipeline_state = 'indexed'
           AND c.embedding IS NOT NULL
           AND c.embedding_model = ?`,
      )
      .get(embedder?.modelId ?? '') as { count: number }

    const total = totalRow.count
    const embedded = embeddedRow.count

    return {
      embedded,
      total,
      percent: total > 0 ? Math.round((embedded / total) * 100) : 0,
      isReady: total > 0 && embedded === total,
      hasProvider: Boolean(embedder),
    }
  }

  private async tick(): Promise<void> {
    if (this.running || Date.now() < this.nextRetryAt) {
      return
    }

    const { embedder } = this.getProviders()
    if (!embedder) {
      return
    }

    this.running = true
    try {
      await this.processBatch(embedder)
      this.retryDelayMs = INITIAL_BACKOFF_MS
      this.nextRetryAt = 0
    } catch (error) {
      console.error('[EmbeddingLoop] tick error:', error)
    } finally {
      this.running = false
    }
  }

  private async processBatch(embedder: EmbeddingProvider): Promise<void> {
    const limit = Math.min(BATCH_SIZE, embedder.maxBatchSize)
    const chunks = this.db
      .prepare(
        `SELECT c.id, c.text
         FROM chunks c
         JOIN files f ON f.id = c.file_id
         WHERE f.pipeline_state = 'indexed'
           AND (c.embedding IS NULL OR c.embedding_model != ?)
         ORDER BY c.id
         LIMIT ?`,
      )
      .all(embedder.modelId, limit) as PendingChunkRow[]

    if (chunks.length === 0) {
      return
    }

    let embeddings: number[][]
    try {
      embeddings = await embedder.embed(
        chunks.map((chunk) => chunk.text),
        'document',
      )
    } catch (error: unknown) {
      if ((error as { status?: number }).status === 429) {
        this.nextRetryAt = Date.now() + this.retryDelayMs
        this.retryDelayMs = Math.min(this.retryDelayMs * 2, MAX_BACKOFF_MS)
        console.warn('[EmbeddingLoop] rate limited, will retry later')
        return
      }
      throw error
    }

    const rows = embeddings.slice(0, chunks.length).map((raw, index) => ({
      id: chunks[index].id,
      embedding: serializeEmbedding(normalizeVector(new Float32Array(raw))),
    }))

    if (rows.length === 0) {
      return
    }

    const update = this.db.prepare(
      `UPDATE chunks
       SET embedding = ?, embedding_model = ?
       WHERE id = ?`,
    )
    const updateMany = this.db.transaction(
      (batch: Array<{ id: string; embedding: Buffer }>, modelId: string) => {
        for (const row of batch) {
          update.run(row.embedding, modelId, row.id)
        }
      },
    )

    updateMany(rows, embedder.modelId)
    this.emit(this.getStats())
  }
}
