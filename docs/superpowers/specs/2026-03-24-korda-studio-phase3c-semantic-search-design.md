# Phase 3C: Semantic Search (Embeddings) — Design Spec

**Date:** 2026-03-24
**Status:** Approved
**Author:** Claude Opus 4.6 + Matt Harrington
**Repo:** korda-studio
**Depends on:** Phase 3A (RAG Foundation), Phase 3B (Grounded Chat)

---

## 1. Overview

Phase 3C adds vector embeddings, hybrid BM25+vector retrieval, Reciprocal Rank Fusion (RRF), and optional Cohere reranking to the existing keyword-only RAG stack. The result is semantically-aware search that finds conceptually related chunks even when exact keywords don't match.

### Design Decisions

| Decision            | Choice                                     | Rationale                                                                                     |
| ------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Embedding providers | Voyage AI + Cohere via abstraction         | Config fields already exist; both SDKs already installed or trivial to add                    |
| Vector storage      | SQLite BLOB (Float32Array)                 | Korda Studio corpora are <50K chunks; brute-force cosine <50ms; zero native binary complexity |
| Reranking           | RRF default, optional Cohere rerank        | RRF is zero-cost baseline; Cohere rerank is best-in-class quality upgrade when key available  |
| Embedding timing    | Background post-processing loop            | Keeps ingestion fast; graceful degradation; keyword search works without any API key          |
| Batch strategy      | 32 chunks/call, 1 concurrent, 100ms delay  | Predictable rate-limit-friendly throughput for a desktop app                                  |
| UI feedback         | KnowledgeStatusBanner embedding progress   | Reuses existing banner pattern; per-source detail deferred                                    |
| Scale migration     | BLOB + brute-force now, `sqlite-vec` later | Practical for target corpus size; BLOB data already there for future ANN index                |

### Graceful Degradation Chain

```
No API key         → keyword-only (FTS5/BM25), all features work
Embeddings partial → hybrid search on embedded chunks, keyword fallback for rest
Embeddings ready   → full hybrid (BM25 + cosine + RRF)
Cohere key present → RRF + Cohere rerank final pass
```

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Ingestion Pipeline (unchanged)                             │
│  extract → chunk → indexed                                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ async, independent
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  EmbeddingLoop (NEW — main process)                         │
│                                                             │
│  every 10s: SELECT chunks WHERE embedding IS NULL           │
│             AND file pipeline_state = 'indexed'             │
│             LIMIT 32                                        │
│           → EmbeddingProvider.embed(texts)                  │
│           → UPDATE chunks SET embedding=?, embedding_model=? │
│           → emit EMBEDDING_PROGRESS IPC                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  RetrievalService.search() (extended)                       │
│                                                             │
│  mode='keyword'  → FTS5/BM25 only (unchanged)              │
│  mode='vector'   → cosine similarity over BLOBs             │
│  mode='hybrid'   → BM25 + vector → RRF → optional rerank   │
│  mode='auto'     → hybrid if isVectorReady(), else keyword  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  EmbeddingProvider abstraction                              │
│                                                             │
│  interface EmbeddingProvider {                              │
│    embed(texts: string[]): Promise<number[][]>              │
│    dimensions: number                                       │
│    modelId: string                                          │
│    maxBatchSize: number                                     │
│  }                                                          │
│                                                             │
│  VoyageEmbeddingProvider  — voyage-3, 1024 dims             │
│  CohereEmbeddingProvider  — embed-english-v3.0, 1024 dims   │
│                           — also implements RerankerProvider │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Contracts

### 3.1 `src/shared/contracts/embedding-provider-contract.ts`

```typescript
export interface EmbeddingProvider {
  embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]>
  readonly dimensions: number
  readonly modelId: string
  readonly maxBatchSize: number
}

export interface RerankerProvider {
  rerank(query: string, documents: string[], topN: number): Promise<RerankResult[]>
  readonly rerankModelId: string
}

export interface RerankResult {
  index: number // original document index
  relevanceScore: number // 0–1
}

export type EmbeddingInputType = 'document' | 'query'

export interface EmbeddingStats {
  embedded: number
  total: number
  percent: number // 0–100, rounded integer
  isReady: boolean // true when embedded === total && total > 0
}
```

### 3.2 Updates to `src/shared/contracts/retrieval-contract.ts`

Add method to existing `RetrievalProvider`:

```typescript
export interface RetrievalProvider {
  search(params: RetrievalParams): Promise<RetrievalResult[]>
  isVectorReady(): boolean
  getEmbeddingStats(): EmbeddingStats // NEW
}
```

`RetrievalMode` already defined as `'keyword' | 'vector' | 'hybrid'`. Add `'auto'` variant:

```typescript
export type RetrievalMode = 'keyword' | 'vector' | 'hybrid' | 'auto'
```

### 3.3 Updates to `src/shared/ai-config.ts`

```typescript
export interface AIConfig {
  // ... existing fields unchanged ...
  voyageApiKey?: string // already exists
  cohereApiKey?: string // already exists
  contextualEnrichment?: boolean // already exists
  useReranking?: boolean // NEW: gate Cohere rerank pass (default: false)
  retrievalMode?: RetrievalMode // NEW: default 'auto'
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  // ... existing defaults ...
  useReranking: false,
  retrievalMode: 'auto',
}
```

### 3.4 Updates to `src/shared/ipc-types.ts`

```typescript
// New payload type
export interface EmbeddingProgressPayload {
  embedded: number
  total: number
  percent: number
  isReady: boolean
}

// New IPC channels (add to IPC_CHANNELS object)
EMBEDDING_PROGRESS = 'embedding:progress'
EMBEDDING_STATS    = 'embedding:stats'

// New KordaAPI methods
onEmbeddingProgress(cb: (payload: EmbeddingProgressPayload) => void): () => void
getEmbeddingStats(): Promise<EmbeddingStats>
```

---

## 4. Embedding Providers

### 4.1 `src/main/voyageEmbeddingProvider.ts`

```typescript
import Voyage from 'voyageai'

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1024
  readonly modelId = 'voyage-3'
  readonly maxBatchSize = 96

  private client: Voyage

  constructor(apiKey: string) {
    this.client = new Voyage({ apiKey })
  }

  async embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
    const voyageInputType = inputType === 'query' ? 'query' : 'document'
    const response = await this.client.embed({
      model: this.modelId,
      input: texts,
      inputType: voyageInputType,
    })
    return response.data.map((d) => d.embedding)
  }
}
```

**Error handling:** Throws on non-2xx. Caller (embeddingLoop) handles 429 with exponential backoff.

### 4.2 `src/main/cohereEmbeddingProvider.ts`

```typescript
import { CohereClient } from 'cohere-ai'

export class CohereEmbeddingProvider implements EmbeddingProvider, RerankerProvider {
  readonly dimensions = 1024
  readonly modelId = 'embed-english-v3.0'
  readonly rerankModelId = 'rerank-english-v3.0'
  readonly maxBatchSize = 96

  private client: CohereClient

  constructor(apiKey: string) {
    this.client = new CohereClient({ token: apiKey })
  }

  async embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
    const cohereInputType = inputType === 'query' ? 'search_query' : 'search_document'
    const response = await this.client.embed({
      model: this.modelId,
      texts,
      inputType: cohereInputType,
      embeddingTypes: ['float'],
    })
    return (response.embeddings as { float: number[][] }).float
  }

  async rerank(query: string, documents: string[], topN: number): Promise<RerankResult[]> {
    const response = await this.client.rerank({
      model: this.rerankModelId,
      query,
      documents,
      topN,
    })
    return response.results.map((r) => ({
      index: r.index,
      relevanceScore: r.relevanceScore,
    }))
  }
}
```

### 4.3 `src/main/embeddingProviderFactory.ts`

```typescript
export interface ProviderSet {
  embedder: EmbeddingProvider | null
  reranker: RerankerProvider | null
}

export function createProviders(config: AIConfig): ProviderSet {
  const hasVoyage = Boolean(config.voyageApiKey?.trim())
  const hasCohere = Boolean(config.cohereApiKey?.trim())

  let embedder: EmbeddingProvider | null = null
  let reranker: RerankerProvider | null = null

  if (hasVoyage) {
    embedder = new VoyageEmbeddingProvider(config.voyageApiKey!)
  } else if (hasCohere) {
    embedder = new CohereEmbeddingProvider(config.cohereApiKey!)
  }

  if (hasCohere && config.useReranking) {
    reranker = new CohereEmbeddingProvider(config.cohereApiKey!)
  }

  return { embedder, reranker }
}
```

**Provider priority:** Voyage wins for embeddings. Cohere is always used for reranking (when key present and `useReranking: true`), regardless of which provider generates embeddings.

---

## 5. Vector Utilities

### `src/main/vectorUtils.ts`

```typescript
/**
 * Cosine similarity between two normalized Float32Array vectors.
 * Both vectors MUST be L2-normalized (unit vectors).
 * Returns value in [-1, 1]; higher = more similar.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error('Vector dimension mismatch')
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

/**
 * Normalize a vector to unit length (L2 norm = 1).
 * Modifies in place and returns the same array.
 */
export function normalizeVector(v: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i]
  norm = Math.sqrt(norm)
  if (norm === 0) return v
  for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

/** Serialize Float32Array to Buffer for SQLite BLOB storage. */
export function serializeEmbedding(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer)
}

/** Deserialize SQLite BLOB to Float32Array. */
export function deserializeEmbedding(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4)
}
```

**Note:** Voyage AI and Cohere both return pre-normalized embeddings. We normalize defensively on write to handle any provider edge cases.

---

## 6. Embedding Loop

### `src/main/embeddingLoop.ts`

```typescript
export class EmbeddingLoop {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private embeddedCount = 0

  constructor(
    private db: Database,
    private getProviders: () => ProviderSet,
    private emit: (payload: EmbeddingProgressPayload) => void,
  ) {}

  init(): void {
    this.timer = setInterval(() => this.tick(), 10_000)
    // Run immediately on init
    setImmediate(() => this.tick())
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  getStats(): EmbeddingStats {
    const total = this.db
      .prepare(
        `SELECT COUNT(*) as n FROM chunks
                JOIN files ON files.id = chunks.file_id
                WHERE files.pipeline_state = 'indexed'`,
      )
      .get() as { n: number }
    const embedded = this.db
      .prepare(
        `SELECT COUNT(*) as n FROM chunks
                JOIN files ON files.id = chunks.file_id
                WHERE files.pipeline_state = 'indexed'
                AND chunks.embedding IS NOT NULL
                AND chunks.embedding_model = ?`,
      )
      .get(this.getProviders().embedder?.modelId ?? '') as { n: number }
    const t = total.n
    const e = embedded.n
    return {
      embedded: e,
      total: t,
      percent: t > 0 ? Math.round((e / t) * 100) : 0,
      isReady: t > 0 && e === t,
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return
    const { embedder } = this.getProviders()
    if (!embedder) return

    this.running = true
    try {
      await this.processBatch(embedder)
    } catch (err) {
      console.error('[EmbeddingLoop] tick error:', err)
    } finally {
      this.running = false
    }
  }

  private async processBatch(embedder: EmbeddingProvider): Promise<void> {
    // Fetch batch of unembedded chunks (or stale model)
    const chunks = this.db
      .prepare(
        `SELECT c.id, c.text FROM chunks c
         JOIN files f ON f.id = c.file_id
         WHERE f.pipeline_state = 'indexed'
           AND (c.embedding IS NULL OR c.embedding_model != ?)
         LIMIT 32`,
      )
      .all(embedder.modelId) as { id: string; text: string }[]

    if (chunks.length === 0) return

    const texts = chunks.map((c) => c.text)
    let embeddings: number[][]

    try {
      embeddings = await embedder.embed(texts, 'document')
    } catch (err: unknown) {
      const status = (err as { status?: number }).status
      if (status === 429) {
        // Back off — will retry on next tick
        console.warn('[EmbeddingLoop] rate limited, backing off')
        return
      }
      throw err
    }

    // Persist embeddings
    const update = this.db.prepare(
      `UPDATE chunks SET embedding = ?, embedding_model = ? WHERE id = ?`,
    )
    const updateMany = this.db.transaction((rows: { id: string; vec: Float32Array }[]) => {
      for (const row of rows) {
        update.run(serializeEmbedding(row.vec), embedder.modelId, row.id)
      }
    })

    const rows = embeddings.map((raw, i) => ({
      id: chunks[i].id,
      vec: normalizeVector(new Float32Array(raw)),
    }))
    updateMany(rows)

    // Emit progress
    const stats = this.getStats()
    this.emit(stats)

    // Throttle: 100ms between batches
    await new Promise((r) => setTimeout(r, 100))
  }
}
```

**Re-embedding on model change:** The query `c.embedding_model != ?` catches chunks embedded with a previous provider/model and re-embeds them. This handles provider switches gracefully.

---

## 7. Retrieval Service Extensions

### `src/main/retrievalService.ts` changes

#### 7.1 Vector search

```typescript
private async searchVector(
  params: RetrievalParams,
  queryEmbedding: Float32Array,
  limit: number,
): Promise<RetrievalResult[]> {
  const modelId = this.getProviders().embedder!.modelId

  const rows = this.db
    .prepare(
      `SELECT c.id, c.text, c.embedding, c.file_id, c.chunk_index,
              c.page_number, c.section_title, c.sheet_name,
              f.path, f.name, f.source_id, f.project, f.discipline,
              f.doc_type, f.drawing_number, f.revision
       FROM chunks c
       JOIN files f ON f.id = c.file_id
       WHERE c.embedding IS NOT NULL
         AND c.embedding_model = ?
         AND f.pipeline_state = 'indexed'
         AND (? IS NULL OR f.source_id = ?)
         AND (? IS NULL OR f.project = ?)`,
    )
    .all(
      modelId,
      params.sourceId ?? null, params.sourceId ?? null,
      params.project ?? null,  params.project ?? null,
    ) as RawChunkRow[]

  return rows
    .map((row) => {
      const vec = deserializeEmbedding(row.embedding as Buffer)
      const score = cosineSimilarity(queryEmbedding, vec)
      return { row, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row, score }) => this.mapToResult(row, null, score, null))
}
```

#### 7.2 Hybrid search with RRF

```typescript
private mergeWithRRF(
  bm25Results: RetrievalResult[],
  vectorResults: RetrievalResult[],
): RetrievalResult[] {
  const K = 60  // standard RRF constant
  const scores = new Map<string, { result: RetrievalResult; rrf: number }>()

  bm25Results.forEach((r, rank) => {
    const id = r.chunk.id
    const existing = scores.get(id)
    const rrf = 1 / (K + rank + 1)
    scores.set(id, {
      result: r,
      rrf: (existing?.rrf ?? 0) + rrf,
    })
  })

  vectorResults.forEach((r, rank) => {
    const id = r.chunk.id
    const existing = scores.get(id)
    const rrf = 1 / (K + rank + 1)
    scores.set(id, {
      result: existing?.result ?? r,
      rrf: (existing?.rrf ?? 0) + rrf,
    })
  })

  return [...scores.values()]
    .sort((a, b) => b.rrf - a.rrf)
    .map(({ result, rrf }) => ({ ...result, rrfScore: rrf }))
}
```

#### 7.3 Optional Cohere rerank

```typescript
private async applyRerank(
  query: string,
  results: RetrievalResult[],
  reranker: RerankerProvider,
  topN: number,
): Promise<RetrievalResult[]> {
  if (results.length === 0) return results
  const documents = results.map((r) => r.chunk.text)
  const reranked = await reranker.rerank(query, documents, topN)
  return reranked.map(({ index }) => results[index])
}
```

#### 7.4 Main `search()` method routing

```typescript
async search(params: RetrievalParams): Promise<RetrievalResult[]> {
  const { embedder, reranker } = this.getProviders()
  const effectiveMode = this.resolveMode(params.mode, embedder)
  const limit = params.limit ?? 20

  if (effectiveMode === 'keyword') {
    return this.searchKeyword(params, limit)
  }

  if (effectiveMode === 'vector') {
    const queryVec = await this.embedQuery(params.query, embedder!)
    const results = await this.searchVector(params, queryVec, limit)
    return reranker ? this.applyRerank(params.query, results, reranker, limit) : results
  }

  // hybrid
  const [keywordResults, vectorResults] = await Promise.all([
    this.searchKeyword(params, limit * 2),     // wider net for RRF
    (async () => {
      const queryVec = await this.embedQuery(params.query, embedder!)
      return this.searchVector(params, queryVec, limit * 2)
    })(),
  ])
  const merged = this.mergeWithRRF(keywordResults, vectorResults).slice(0, limit)
  return reranker ? this.applyRerank(params.query, merged, reranker, limit) : merged
}

private resolveMode(
  requested: RetrievalMode | undefined,
  embedder: EmbeddingProvider | null,
): 'keyword' | 'vector' | 'hybrid' {
  const mode = requested ?? 'auto'
  if (mode === 'auto') return embedder && this.isVectorReady() ? 'hybrid' : 'keyword'
  if ((mode === 'vector' || mode === 'hybrid') && (!embedder || !this.isVectorReady())) {
    return 'keyword'  // graceful fallback
  }
  return mode
}

isVectorReady(): boolean {
  const { embedder } = this.getProviders()
  if (!embedder) return false
  const row = this.db
    .prepare(
      `SELECT COUNT(*) as n FROM chunks c
       JOIN files f ON f.id = c.file_id
       WHERE f.pipeline_state = 'indexed'
         AND c.embedding IS NULL`,
    )
    .get() as { n: number }
  return row.n === 0
}
```

**Note:** `isVectorReady()` returns `true` only when zero unembedded chunks remain for indexed files. During background embedding it returns `false`, so mode stays `'keyword'` until complete.

#### 7.5 Query embedding with caching

```typescript
private queryEmbeddingCache = new Map<string, Float32Array>()

private async embedQuery(
  query: string,
  embedder: EmbeddingProvider,
): Promise<Float32Array> {
  const key = `${embedder.modelId}:${query}`
  if (this.queryEmbeddingCache.has(key)) return this.queryEmbeddingCache.get(key)!
  const [raw] = await embedder.embed([query], 'query')
  const vec = normalizeVector(new Float32Array(raw))
  this.queryEmbeddingCache.set(key, vec)
  // Evict oldest if cache grows beyond 100 entries
  if (this.queryEmbeddingCache.size > 100) {
    this.queryEmbeddingCache.delete(this.queryEmbeddingCache.keys().next().value)
  }
  return vec
}
```

---

## 8. Schema Migration

**In `src/main/fileIndexService.ts` `runMigrations()`:**

```typescript
// Phase 3C: embedding_model column on chunks
try {
  db.exec(`ALTER TABLE chunks ADD COLUMN embedding_model TEXT`)
} catch {
  // column already exists
}
```

This is the only schema change. The `embedding BLOB` column already exists from Phase 3A.

---

## 9. IPC Integration

### `src/main/main.ts` additions

```typescript
// On app ready, after ingestionQueue.init():
const embeddingLoop = new EmbeddingLoop(
  db,
  () => createProviders(getAIConfig()),
  (payload) => mainWindow.webContents.send(IPC_CHANNELS.EMBEDDING_PROGRESS, payload),
)
embeddingLoop.init()

// Handler: request current stats
ipcMain.handle(IPC_CHANNELS.EMBEDDING_STATS, () => embeddingLoop.getStats())

// Restart loop when AI config changes (new API key entered):
ipcMain.handle(IPC_CHANNELS.SAVE_AI_CONFIG, (_e, config: AIConfig) => {
  saveAIConfig(config)
  embeddingLoop.init() // no-op if already running; re-checks provider
})
```

### `src/preload/preload.ts` additions

```typescript
onEmbeddingProgress: (cb) => {
  const handler = (_: IpcRendererEvent, payload: EmbeddingProgressPayload) => cb(payload)
  ipcRenderer.on(IPC_CHANNELS.EMBEDDING_PROGRESS, handler)
  return () => ipcRenderer.removeListener(IPC_CHANNELS.EMBEDDING_PROGRESS, handler)
},
getEmbeddingStats: () =>
  ipcRenderer.invoke(IPC_CHANNELS.EMBEDDING_STATS),
```

---

## 10. AI Settings UI

### `src/renderer/modules/settings/AISettingsModule.tsx` — new "Knowledge Retrieval" section

```tsx
<section>
  <h3>Knowledge Retrieval</h3>

  <label>Voyage AI API Key
    <input type="password" value={config.voyageApiKey ?? ''} onChange={...} />
    <span className="hint">voyage-3 · 1024 dims — preferred for embeddings</span>
  </label>

  <label>Cohere API Key
    <input type="password" value={config.cohereApiKey ?? ''} onChange={...} />
    <span className="hint">embed-english-v3.0 · 1024 dims — also enables reranking</span>
  </label>

  <ProviderPriorityHint voyageKey={config.voyageApiKey} cohereKey={config.cohereApiKey} />

  <label>
    <input
      type="checkbox"
      checked={config.useReranking ?? false}
      onChange={...}
      disabled={!config.cohereApiKey?.trim()}
    />
    Use Cohere reranking when available
  </label>

  <fieldset>
    <legend>Retrieval Mode</legend>
    {(['auto', 'hybrid', 'keyword'] as RetrievalMode[]).map((mode) => (
      <label key={mode}>
        <input
          type="radio"
          name="retrievalMode"
          value={mode}
          checked={(config.retrievalMode ?? 'auto') === mode}
          onChange={...}
        />
        {mode === 'auto' ? 'Auto (recommended)' : mode === 'hybrid' ? 'Hybrid' : 'Keyword only'}
      </label>
    ))}
  </fieldset>
</section>
```

**`ProviderPriorityHint` component** (inline, same file):

| Keys present | Message                                       |
| ------------ | --------------------------------------------- |
| Both         | "Voyage (embeddings) · Cohere (rerank)"       |
| Voyage only  | "Voyage (embeddings)"                         |
| Cohere only  | "Cohere (embeddings + rerank)"                |
| Neither      | "No embedding provider — keyword search only" |

---

## 11. Knowledge Status Banner Extension

### `src/renderer/modules/knowledge/components/KnowledgeStatusBanner.tsx`

New `embeddingStats` prop added. Banner shows embedding state when ingestion is idle:

```tsx
interface KnowledgeStatusBannerProps {
  ingestionStatus: IngestionStatus // existing
  embeddingStats: EmbeddingStats | null // NEW
}
```

**Banner state priority:**

| Condition                           | Banner                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| Ingesting                           | ⏳ "Ingesting files..." (existing, highest priority)                                    |
| Embedding in progress               | 🔵 "Embedding knowledge base... N / M chunks (X%)" + progress bar                       |
| No provider configured              | ℹ️ "Keyword search only — add an embedding API key in Settings to enable hybrid search" |
| All embedded                        | Banner hidden (same as existing "all indexed" behavior)                                 |
| Embedding error (429 / API failure) | 🔴 "Embedding paused — check API key in Settings"                                       |

---

## 12. ToolRegistry Auto-Mode

### `src/main/toolRegistry.ts` change

```typescript
// In searchKnowledgeBaseTool.execute():
const results = await retrievalService.search({
  query,
  sourceId: combo.sourceId,
  project: combo.project,
  limit,
  mode: 'auto', // was undefined; now explicit 'auto' so hybrid kicks in when ready
})
```

No other toolRegistry changes needed — `retrievalService.search()` handles mode resolution internally.

---

## 13. Testing Strategy

### Unit tests

| File                               | Tests                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `voyageEmbeddingProvider.test.ts`  | Mock SDK: embed() calls correct model + inputType; handles 429                                                                                                                        |
| `cohereEmbeddingProvider.test.ts`  | Mock SDK: embed() + rerank() correct model; float embedding extraction                                                                                                                |
| `embeddingProviderFactory.test.ts` | Voyage key → Voyage embedder; Cohere key → Cohere embedder; both → Voyage embed + Cohere rerank; neither → null                                                                       |
| `vectorUtils.test.ts`              | cosineSimilarity: identical=1, orthogonal=0, opposite=-1; normalizeVector; serialize/deserialize round-trip                                                                           |
| `embeddingLoop.test.ts`            | processBatch calls embed + persists BLOBs; 429 backs off without throwing; model change triggers re-embed; getStats() returns correct counts                                          |
| `retrievalService.test.ts`         | keyword mode unchanged; vector mode returns cosine-sorted results; hybrid merges via RRF; mode='auto' falls back to keyword when !isVectorReady; rerank applied when reranker present |
| `embeddingProviderFactory.test.ts` | useReranking=false → reranker=null even with Cohere key                                                                                                                               |

### Integration tests

- `embeddingLoop.integration.test.ts` — real SQLite DB; inserts chunks; runs tick(); asserts embedding BLOBs persisted and stats correct.
- `retrievalService.hybrid.test.ts` — seeds DB with embedded chunks; search('hybrid') returns RRF-merged results; confirms vector-only results appear that BM25 misses.

---

## 14. File Map

### New files

| File                                                  | Purpose                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/shared/contracts/embedding-provider-contract.ts` | `EmbeddingProvider`, `RerankerProvider`, `RerankResult`, `EmbeddingStats` |
| `src/main/voyageEmbeddingProvider.ts`                 | Voyage AI embed implementation                                            |
| `src/main/voyageEmbeddingProvider.test.ts`            | Unit tests                                                                |
| `src/main/cohereEmbeddingProvider.ts`                 | Cohere embed + rerank implementation                                      |
| `src/main/cohereEmbeddingProvider.test.ts`            | Unit tests                                                                |
| `src/main/embeddingProviderFactory.ts`                | Provider selection from AIConfig                                          |
| `src/main/embeddingProviderFactory.test.ts`           | Unit tests                                                                |
| `src/main/embeddingLoop.ts`                           | Background embedding loop                                                 |
| `src/main/embeddingLoop.test.ts`                      | Unit + integration tests                                                  |
| `src/main/vectorUtils.ts`                             | Cosine similarity, normalize, serialize/deserialize                       |
| `src/main/vectorUtils.test.ts`                        | Unit tests                                                                |

### Modified files

| File                                                                  | Change                                                                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/shared/contracts/retrieval-contract.ts`                          | Add `'auto'` to `RetrievalMode`; add `getEmbeddingStats()` to `RetrievalProvider`                    |
| `src/shared/ai-config.ts`                                             | Add `useReranking`, `retrievalMode` fields                                                           |
| `src/shared/ipc-types.ts`                                             | `EmbeddingProgressPayload`, new channels, `KordaAPI` extensions                                      |
| `src/main/retrievalService.ts`                                        | Vector search, hybrid search, RRF, rerank, query embedding cache, `resolveMode()`, `isVectorReady()` |
| `src/main/toolRegistry.ts`                                            | Pass `mode: 'auto'` to retrievalService.search()                                                     |
| `src/main/fileIndexService.ts`                                        | Migration: `chunks.embedding_model TEXT` column                                                      |
| `src/main/main.ts`                                                    | `embeddingLoop.init()`, `EMBEDDING_STATS` handler, restart on config save                            |
| `src/preload/preload.ts`                                              | `onEmbeddingProgress`, `getEmbeddingStats` bridges                                                   |
| `src/renderer/modules/settings/AISettingsModule.tsx`                  | Knowledge Retrieval section                                                                          |
| `src/renderer/modules/knowledge/components/KnowledgeStatusBanner.tsx` | Embedding progress states                                                                            |

### New dependency

```
voyageai
```

(`cohere-ai` already installed; `better-sqlite3` handles BLOBs natively.)

---

## 15. Sequence Diagram — Hybrid Grounded Chat Query

```
User asks grounded question
    │
    ▼
groundedChatService.sendGrounded()
    │
    ├── rewriteQuery() [Haiku] → ["query A", "query B"]
    │
    ├── Pass 1: toolRegistry.runToolLoop()
    │       │
    │       └── search_knowledge_base tool
    │               │
    │               └── retrievalService.search({ mode: 'auto' })
    │                       │
    │                       ├── if !isVectorReady() → FTS5/BM25 only
    │                       │
    │                       └── if isVectorReady():
    │                               ├── FTS5/BM25 (top 40)
    │                               ├── embedQuery() → cosine search (top 40)
    │                               ├── mergeWithRRF() → top 20
    │                               └── if reranker → applyRerank() → top 20
    │
    └── Pass 2: Citations API streaming [Sonnet]
            └── retrieved chunks as document blocks
```

---

## 16. Non-Goals (Phase 3C)

- `sqlite-vec` / ANN indexing (deferred; brute-force sufficient at target scale)
- Per-source embedding status on Connections page (deferred)
- Embedding progress during ingestion inline (background loop only)
- Multi-lingual embedding models
- Local/offline embedding models (Ollama etc.)
- Custom embedding dimensions
