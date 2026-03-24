import type Database from 'better-sqlite3'
import type { ChunkRecord } from '../shared/contracts/chunk-record'
import type {
  RetrievalParams,
  RetrievalProvider,
  RetrievalResult,
  RetrievalMode,
} from '../shared/contracts/retrieval-contract'
import type {
  EmbeddingProvider,
  RerankerProvider,
} from '../shared/contracts/embedding-provider-contract'
import type { FileEntry, IngestionStatus } from '../shared/ipc-types'
import type { ProviderSet } from './embeddingProviderFactory'
import { cosineSimilarity, deserializeEmbedding, normalizeVector } from './vectorUtils'

interface RetrievalRow {
  id: string
  file_id: number
  chunk_index: number
  text: string
  token_count: number
  char_count: number
  page_number: number | null
  section_title: string | null
  sheet_name: string | null
  embedding: Buffer | null
  created_at: number
  chunk_source_id: string
  path: string
  name: string
  ext: string
  size_bytes: number
  modified_ms: number
  project: string | null
  discipline: string | null
  doc_type: string | null
  source_id: string | null
  drawing_number: string | null
  revision: string | null
  issue_status: string | null
  bm25_score: number | null
  highlight: string | null
}

interface ChunkRow {
  id: string
  file_id: number
  source_id: string
  chunk_index: number
  text: string
  token_count: number
  char_count: number
  page_number: number | null
  section_title: string | null
  sheet_name: string | null
  embedding: Buffer | null
  created_at: number
}

interface VectorRow extends Omit<RetrievalRow, 'bm25_score' | 'highlight'> {
  embedding: Buffer
}

const PIPELINE_STATES = [
  'new',
  'queued',
  'extracting',
  'chunking',
  'contextualizing',
  'indexed',
  'failed',
  'skipped',
] as const

export class RetrievalService implements RetrievalProvider {
  private readonly queryEmbeddingCache = new Map<string, Float32Array>()

  constructor(
    private readonly db: Database.Database,
    private readonly getProviders: () => ProviderSet = () => ({ embedder: null, reranker: null }),
  ) {}

  isVectorReady(): boolean {
    const { embedder } = this.getProviders()
    if (!embedder) {
      return false
    }

    const totalRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM chunks c
         JOIN files f ON f.id = c.file_id
         WHERE f.pipeline_state = 'indexed'`,
      )
      .get() as { count: number }
    const incompleteRow = this.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM chunks c
         JOIN files f ON f.id = c.file_id
         WHERE f.pipeline_state = 'indexed'
           AND (c.embedding IS NULL OR c.embedding_model != ?)`,
      )
      .get(embedder.modelId) as { count: number }

    return totalRow.count > 0 && incompleteRow.count === 0
  }

  async search(params: RetrievalParams): Promise<RetrievalResult[]> {
    const { embedder, reranker } = this.getProviders()
    const effectiveMode = this.resolveMode(params.mode, embedder)
    const limit = params.limit ?? 10

    if (effectiveMode === 'keyword') {
      return this.keywordSearch(params.query, params.sourceId, params.project, limit)
    }

    if (effectiveMode === 'vector') {
      const queryVector = await this.embedQuery(params.query, embedder!)
      const results = await this.searchVector(params, queryVector, limit)
      return reranker ? this.applyRerank(params.query, results, reranker, limit) : results
    }

    const [keywordResults, vectorResults] = await Promise.all([
      Promise.resolve(this.keywordSearch(params.query, params.sourceId, params.project, limit * 2)),
      (async () => {
        const queryVector = await this.embedQuery(params.query, embedder!)
        return this.searchVector(params, queryVector, limit * 2)
      })(),
    ])
    const merged = this.mergeWithRRF(keywordResults, vectorResults).slice(0, limit)

    return reranker ? this.applyRerank(params.query, merged, reranker, limit) : merged
  }

  getAdjacentChunks(
    fileId: number,
    chunkIndex: number,
  ): {
    prev: ChunkRecord | null
    next: ChunkRecord | null
  } {
    return {
      prev: this.getChunk(fileId, chunkIndex - 1),
      next: this.getChunk(fileId, chunkIndex + 1),
    }
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

  private resolveMode(
    requested: RetrievalMode | undefined,
    embedder: EmbeddingProvider | null,
  ): 'keyword' | 'vector' | 'hybrid' {
    const mode = requested ?? 'auto'
    if (mode === 'auto') {
      return embedder && this.isVectorReady() ? 'hybrid' : 'keyword'
    }
    if ((mode === 'vector' || mode === 'hybrid') && (!embedder || !this.isVectorReady())) {
      return 'keyword'
    }
    return mode
  }

  private async searchVector(
    params: RetrievalParams,
    queryEmbedding: Float32Array,
    limit: number,
  ): Promise<RetrievalResult[]> {
    const { embedder } = this.getProviders()
    const rows = this.db
      .prepare(
        `SELECT
          c.id,
          c.file_id,
          c.chunk_index,
          c.text,
          c.token_count,
          c.char_count,
          c.page_number,
          c.section_title,
          c.sheet_name,
          c.embedding,
          c.created_at,
          c.source_id AS chunk_source_id,
          f.path,
          f.name,
          f.ext,
          f.size_bytes,
          f.modified_ms,
          f.project,
          f.discipline,
          f.doc_type,
          f.source_id,
          f.drawing_number,
          f.revision,
          f.issue_status
        FROM chunks c
        JOIN files f ON f.id = c.file_id
        WHERE c.embedding IS NOT NULL
          AND c.embedding_model = ?
          AND f.pipeline_state = 'indexed'
          AND (? IS NULL OR f.source_id = ?)
          AND (? IS NULL OR f.project = ?)
        ORDER BY c.chunk_index`,
      )
      .all(
        embedder!.modelId,
        params.sourceId ?? null,
        params.sourceId ?? null,
        params.project ?? null,
        params.project ?? null,
      ) as VectorRow[]

    return rows
      .map((row) => ({
        row,
        score: cosineSimilarity(queryEmbedding, deserializeEmbedding(row.embedding)),
      }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ row, score }) => ({
        chunk: this.mapChunk(row),
        file: this.mapFile(row),
        bm25Score: null,
        vectorDistance: score,
        rrfScore: null,
        highlight: '',
      }))
  }

  private mergeWithRRF(
    bm25Results: RetrievalResult[],
    vectorResults: RetrievalResult[],
  ): RetrievalResult[] {
    const K = 60
    const scores = new Map<string, { result: RetrievalResult; rrf: number }>()

    bm25Results.forEach((result, rank) => {
      const rrf = 1 / (K + rank + 1)
      const existing = scores.get(result.chunk.id)
      scores.set(result.chunk.id, {
        result,
        rrf: (existing?.rrf ?? 0) + rrf,
      })
    })

    vectorResults.forEach((result, rank) => {
      const rrf = 1 / (K + rank + 1)
      const existing = scores.get(result.chunk.id)
      scores.set(result.chunk.id, {
        result: existing?.result ?? result,
        rrf: (existing?.rrf ?? 0) + rrf,
      })
    })

    return [...scores.values()]
      .sort((a, b) => b.rrf - a.rrf)
      .map(({ result, rrf }) => ({
        ...result,
        rrfScore: rrf,
      }))
  }

  private async applyRerank(
    query: string,
    results: RetrievalResult[],
    reranker: RerankerProvider,
    topN: number,
  ): Promise<RetrievalResult[]> {
    if (results.length === 0) {
      return results
    }

    const reranked = await reranker.rerank(
      query,
      results.map((result) => result.chunk.text),
      topN,
    )

    return reranked.map(({ index }) => results[index]).filter(Boolean)
  }

  private async embedQuery(query: string, embedder: EmbeddingProvider): Promise<Float32Array> {
    const key = `${embedder.modelId}:${query}`
    const cached = this.queryEmbeddingCache.get(key)
    if (cached) {
      return cached
    }

    const [raw] = await embedder.embed([query], 'query')
    const vector = normalizeVector(new Float32Array(raw))

    this.queryEmbeddingCache.set(key, vector)
    if (this.queryEmbeddingCache.size > 100) {
      this.queryEmbeddingCache.delete(this.queryEmbeddingCache.keys().next().value!)
    }

    return vector
  }

  private keywordSearch(
    query: string,
    sourceId: string | undefined,
    project: string | undefined,
    limit: number,
  ): RetrievalResult[] {
    const rows = this.db
      .prepare(
        `SELECT
          c.id,
          c.file_id,
          c.chunk_index,
          c.text,
          c.token_count,
          c.char_count,
          c.page_number,
          c.section_title,
          c.sheet_name,
          c.embedding,
          c.created_at,
          c.source_id AS chunk_source_id,
          f.path,
          f.name,
          f.ext,
          f.size_bytes,
          f.modified_ms,
          f.project,
          f.discipline,
          f.doc_type,
          f.source_id,
          f.drawing_number,
          f.revision,
          f.issue_status,
          fts.rank AS bm25_score,
          snippet(chunks_fts, 0, '<mark>', '</mark>', '…', 32) AS highlight
        FROM chunks_fts fts
        JOIN chunks c ON c.rowid = fts.rowid
        JOIN files f ON f.id = c.file_id
        WHERE chunks_fts MATCH ?
          AND f.pipeline_state = 'indexed'
          AND (? IS NULL OR f.source_id = ?)
          AND (? IS NULL OR f.project = ?)
        ORDER BY fts.rank
        LIMIT ?`,
      )
      .all(
        query,
        sourceId ?? null,
        sourceId ?? null,
        project ?? null,
        project ?? null,
        limit,
      ) as RetrievalRow[]

    return rows.map((row) => ({
      chunk: this.mapChunk(row),
      file: this.mapFile(row),
      bm25Score: row.bm25_score,
      vectorDistance: null,
      rrfScore: null,
      highlight: row.highlight ?? '',
    }))
  }

  private getChunk(fileId: number, chunkIndex: number): ChunkRecord | null {
    const row = this.db
      .prepare(
        `SELECT
          id,
          file_id,
          source_id,
          chunk_index,
          text,
          token_count,
          char_count,
          page_number,
          section_title,
          sheet_name,
          embedding,
          created_at
        FROM chunks
        WHERE file_id = ? AND chunk_index = ?`,
      )
      .get(fileId, chunkIndex) as ChunkRow | undefined

    if (!row) {
      return null
    }

    return this.mapChunk(row)
  }

  private mapChunk(row: ChunkRow | RetrievalRow | VectorRow): ChunkRecord {
    return {
      id: row.id,
      fileId: row.file_id,
      sourceId: 'chunk_source_id' in row ? row.chunk_source_id : row.source_id,
      chunkIndex: row.chunk_index,
      text: row.text,
      tokenCount: row.token_count,
      charCount: row.char_count,
      pageNumber: row.page_number,
      sectionTitle: row.section_title,
      sheetName: row.sheet_name,
      embedding: row.embedding ? Buffer.from(row.embedding) : null,
      createdAt: row.created_at,
    }
  }

  private mapFile(row: RetrievalRow | VectorRow): FileEntry {
    return {
      path: row.path,
      name: row.name,
      ext: row.ext,
      sizeBytes: row.size_bytes,
      modifiedMs: row.modified_ms,
      isDir: false,
      sourceId: row.source_id,
      project: row.project,
      discipline: row.discipline,
      docType: row.doc_type,
      drawingNumber: row.drawing_number,
      revision: row.revision,
      issueStatus: row.issue_status,
    }
  }
}

let service: RetrievalService | null = null

export const retrievalService = {
  init(db: Database.Database, getProviders?: () => ProviderSet): void {
    service = new RetrievalService(db, getProviders)
  },
  search(params: RetrievalParams): Promise<RetrievalResult[]> {
    if (!service) throw new Error('retrievalService not initialized')
    return service.search(params)
  },
  getAdjacentChunks(fileId: number, chunkIndex: number) {
    if (!service) throw new Error('retrievalService not initialized')
    return service.getAdjacentChunks(fileId, chunkIndex)
  },
  getStatus(sourceId?: string) {
    if (!service) throw new Error('retrievalService not initialized')
    return service.getStatus(sourceId)
  },
  isVectorReady(): boolean {
    return service?.isVectorReady() ?? false
  },
}
