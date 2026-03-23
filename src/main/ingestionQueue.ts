import type Database from 'better-sqlite3'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import type {
  FailedIngestionFile,
  IngestionProgressEvent,
  IngestionStatus,
} from '../shared/ipc-types'

const CURRENT_DIR =
  typeof __dirname === 'string' ? __dirname : path.dirname(fileURLToPath(import.meta.url))
const WORKER_ENTRY = path.join(CURRENT_DIR, 'ingestionWorker.js')

type PipelineCountState =
  | 'new'
  | 'queued'
  | 'extracting'
  | 'chunking'
  | 'contextualizing'
  | 'indexed'
  | 'failed'
  | 'skipped'

const PIPELINE_STATES: PipelineCountState[] = [
  'new',
  'queued',
  'extracting',
  'chunking',
  'contextualizing',
  'indexed',
  'failed',
  'skipped',
]

interface QueuedFile {
  id: number
  path: string
  ext: string
  source_id: string
}

export class IngestionQueue {
  private readonly workers: Worker[] = []
  private readonly idleWorkers: Worker[] = []
  private drainTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly db: Database.Database,
    private readonly dbPath: string,
    private readonly onProgress: (event: IngestionProgressEvent) => void,
    private readonly concurrency = 2,
  ) {}

  init(): void {
    for (let index = 0; index < this.concurrency; index += 1) {
      const worker = new Worker(WORKER_ENTRY, {
        workerData: { dbPath: this.dbPath },
      })

      worker.on('message', (message: unknown) => {
        const payload = message as
          | { type: 'ready' }
          | ({ type: 'progress' } & IngestionProgressEvent)

        if (payload.type === 'ready') {
          if (!this.idleWorkers.includes(worker)) {
            this.idleWorkers.push(worker)
          }
          this.dispatchNext()
          return
        }

        this.onProgress(payload)
      })

      worker.on('error', (error) => {
        console.error('[ingestionQueue] worker error:', error)
      })

      this.workers.push(worker)
    }

    this.drainTimer = setInterval(() => {
      this.drainNew()
      this.dispatchNext()
    }, 5_000)
  }

  drainNew(): void {
    this.db
      .prepare(
        `UPDATE files
         SET pipeline_state = 'queued',
             pipeline_updated_at = ?,
             pipeline_error = NULL
         WHERE id IN (
           SELECT id
           FROM files
           WHERE pipeline_state = 'new'
           ORDER BY id
           LIMIT 50
         )`,
      )
      .run(Date.now())
  }

  retry(sourceId?: string): void {
    if (sourceId) {
      this.db
        .prepare(
          `UPDATE files
           SET pipeline_state = 'new',
               pipeline_error = NULL,
               pipeline_updated_at = ?
           WHERE pipeline_state = 'failed' AND source_id = ?`,
        )
        .run(Date.now(), sourceId)
    } else {
      this.db
        .prepare(
          `UPDATE files
           SET pipeline_state = 'new',
               pipeline_error = NULL,
               pipeline_updated_at = ?
           WHERE pipeline_state = 'failed'`,
        )
        .run(Date.now())
    }

    this.drainNew()
    this.dispatchNext()
  }

  getStatus(sourceId?: string): IngestionStatus {
    const counts = {
      new: 0,
      queued: 0,
      extracting: 0,
      chunking: 0,
      contextualizing: 0,
      indexed: 0,
      failed: 0,
      skipped: 0,
    } satisfies Omit<IngestionStatus, 'total' | 'totalChunks' | 'avgChunksPerFile'>

    for (const state of PIPELINE_STATES) {
      const row = sourceId
        ? (this.db
            .prepare(
              'SELECT COUNT(*) AS count FROM files WHERE pipeline_state = ? AND source_id = ?',
            )
            .get(state, sourceId) as { count: number })
        : (this.db
            .prepare('SELECT COUNT(*) AS count FROM files WHERE pipeline_state = ?')
            .get(state) as { count: number })
      counts[state] = row.count
    }

    const chunkRow = sourceId
      ? (this.db
          .prepare('SELECT COUNT(*) AS count FROM chunks WHERE source_id = ?')
          .get(sourceId) as {
          count: number
        })
      : (this.db.prepare('SELECT COUNT(*) AS count FROM chunks').get() as { count: number })

    const total = Object.values(counts).reduce((sum, count) => sum + count, 0)
    const totalChunks = chunkRow.count

    return {
      ...counts,
      total,
      totalChunks,
      avgChunksPerFile: counts.indexed > 0 ? Math.round(totalChunks / counts.indexed) : 0,
    }
  }

  getFailedFiles(sourceId?: string): FailedIngestionFile[] {
    const statement = sourceId
      ? this.db.prepare(
          `SELECT
             id AS fileId,
             path,
             name,
             source_id AS sourceId,
             pipeline_error AS error,
             pipeline_updated_at AS updatedAt
           FROM files
           WHERE pipeline_state = 'failed' AND source_id = ?
           ORDER BY pipeline_updated_at DESC, id DESC`,
        )
      : this.db.prepare(
          `SELECT
             id AS fileId,
             path,
             name,
             source_id AS sourceId,
             pipeline_error AS error,
             pipeline_updated_at AS updatedAt
           FROM files
           WHERE pipeline_state = 'failed'
           ORDER BY pipeline_updated_at DESC, id DESC`,
        )

    return (sourceId ? statement.all(sourceId) : statement.all()) as FailedIngestionFile[]
  }

  stop(): void {
    if (this.drainTimer) {
      clearInterval(this.drainTimer)
      this.drainTimer = null
    }

    for (const worker of this.workers) {
      void worker.terminate()
    }

    this.workers.length = 0
    this.idleWorkers.length = 0
  }

  private dispatchNext(): void {
    while (this.idleWorkers.length > 0) {
      const nextFile = this.db
        .prepare(
          `SELECT id, path, ext, source_id
           FROM files
           WHERE pipeline_state = 'queued'
           ORDER BY id
           LIMIT 1`,
        )
        .get() as QueuedFile | undefined

      if (!nextFile) {
        return
      }

      this.db
        .prepare(
          `UPDATE files
           SET pipeline_state = 'extracting',
               pipeline_updated_at = ?,
               pipeline_error = NULL
           WHERE id = ?`,
        )
        .run(Date.now(), nextFile.id)

      const worker = this.idleWorkers.pop()
      if (!worker) {
        return
      }

      worker.postMessage({
        type: 'job',
        fileId: nextFile.id,
        filePath: nextFile.path,
        sourceId: nextFile.source_id,
        ext: nextFile.ext,
      })
    }
  }
}

let queue: IngestionQueue | null = null

export const ingestionQueue = {
  init(
    db: Database.Database,
    dbPath: string,
    onProgress: (event: IngestionProgressEvent) => void,
    concurrency = 2,
  ): void {
    queue = new IngestionQueue(db, dbPath, onProgress, concurrency)
    queue.init()
    queue.drainNew()
  },
  retry(sourceId?: string): void {
    if (!queue) throw new Error('ingestionQueue not initialized')
    queue.retry(sourceId)
  },
  getStatus(sourceId?: string): IngestionStatus {
    if (!queue) throw new Error('ingestionQueue not initialized')
    return queue.getStatus(sourceId)
  },
  getFailedFiles(sourceId?: string): FailedIngestionFile[] {
    if (!queue) throw new Error('ingestionQueue not initialized')
    return queue.getFailedFiles(sourceId)
  },
  stop(): void {
    queue?.stop()
    queue = null
  },
  drainNew(): void {
    if (!queue) throw new Error('ingestionQueue not initialized')
    queue.drainNew()
  },
}
