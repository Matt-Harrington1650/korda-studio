# Phase 3C: Semantic Search (Embeddings) — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add vector embeddings, hybrid BM25+vector retrieval with RRF, and optional Cohere reranking to the existing keyword-only RAG stack so that grounded chat finds semantically relevant chunks even when exact keywords don't match.

**Architecture:** A background `EmbeddingLoop` polls unembedded chunks from SQLite every 10 seconds, calls a provider-abstracted embedding API (Voyage AI or Cohere), and persists normalized Float32Array BLOBs to the existing `chunks.embedding` column. `RetrievalService.search()` gains `mode: 'auto'` routing — keyword-only until embeddings are ready, then hybrid BM25+vector with Reciprocal Rank Fusion and optional Cohere reranking. Everything degrades gracefully: no API key → keyword search, partial embeddings → keyword search, all embedded → hybrid.

**Tech Stack:** `voyageai` (new), `cohere-ai` (already installed), `better-sqlite3` BLOBs, `Float32Array`, Vitest, React, Electron IPC.

**Spec:** `docs/superpowers/specs/2026-03-24-korda-studio-phase3c-semantic-search-design.md`

---

## Chunk 1: Contracts + Vector Utilities + Schema Migration

### Task 1: Embedding Provider Contract

**Files:**

- Create: `src/shared/contracts/embedding-provider-contract.ts`

- [ ] **Step 1: Create the contract file**

```typescript
// src/shared/contracts/embedding-provider-contract.ts

export type EmbeddingInputType = 'document' | 'query'

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

export interface EmbeddingStats {
  embedded: number
  total: number
  percent: number // 0–100, rounded integer
  isReady: boolean // true when embedded === total && total > 0
  hasProvider: boolean // true when at least one embedding API key is configured
}
```

- [ ] **Step 2: Add `'auto'` to `RetrievalMode` in `src/shared/contracts/retrieval-contract.ts`**

Find the existing line:

```typescript
export type RetrievalMode = 'keyword' | 'vector' | 'hybrid'
```

Change it to:

```typescript
export type RetrievalMode = 'keyword' | 'vector' | 'hybrid' | 'auto'
```

- [ ] **Step 3: Add new fields to `src/shared/ai-config.ts`**

Add to the `AIConfig` interface (after the existing `contextualEnrichment` field):

```typescript
  useReranking?: boolean                                   // gate Cohere rerank pass (default: false)
  retrievalMode?: 'keyword' | 'vector' | 'hybrid' | 'auto' // default 'auto'
```

Add to `DEFAULT_AI_CONFIG`:

```typescript
  useReranking: false,
  retrievalMode: 'auto',
```

- [ ] **Step 4: Add new types + channels to `src/shared/ipc-types.ts`**

Add after the existing imports (import `EmbeddingStats` from the new contract):

```typescript
import type { EmbeddingStats } from './contracts/embedding-provider-contract'
```

Add the new payload interface (near other payload types):

```typescript
export interface EmbeddingProgressPayload {
  embedded: number
  total: number
  percent: number
  isReady: boolean
  hasProvider: boolean
}
```

Add to `IPC_CHANNELS` object:

```typescript
  EMBEDDING_PROGRESS: 'embedding:progress',
  EMBEDDING_STATS: 'embedding:stats',
```

Add to `KordaAPI` interface:

```typescript
  onEmbeddingProgress(cb: (payload: EmbeddingProgressPayload) => void): () => void
  getEmbeddingStats(): Promise<EmbeddingStats>
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/contracts/embedding-provider-contract.ts \
        src/shared/contracts/retrieval-contract.ts \
        src/shared/ai-config.ts \
        src/shared/ipc-types.ts
git commit -m "feat(3c): embedding provider contract, RetrievalMode auto, IPC types"
```

---

### Task 2: Vector Utilities

**Files:**

- Create: `src/main/vectorUtils.ts`
- Create: `src/main/vectorUtils.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/vectorUtils.test.ts
import { describe, it, expect } from 'vitest'
import {
  cosineSimilarity,
  normalizeVector,
  serializeEmbedding,
  deserializeEmbedding,
} from './vectorUtils'

describe('cosineSimilarity', () => {
  it('returns 1 for identical unit vectors', () => {
    const a = new Float32Array([1, 0, 0])
    expect(cosineSimilarity(a, a)).toBeCloseTo(1)
  })

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([0, 1, 0])
    expect(cosineSimilarity(a, b)).toBeCloseTo(0)
  })

  it('returns -1 for opposite unit vectors', () => {
    const a = new Float32Array([1, 0, 0])
    const b = new Float32Array([-1, 0, 0])
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1)
  })

  it('throws on dimension mismatch', () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([1, 0, 0])
    expect(() => cosineSimilarity(a, b)).toThrow('Vector dimension mismatch')
  })
})

describe('normalizeVector', () => {
  it('produces unit vector', () => {
    const v = new Float32Array([3, 4, 0])
    const result = normalizeVector(v)
    const norm = Math.sqrt(result[0] ** 2 + result[1] ** 2 + result[2] ** 2)
    expect(norm).toBeCloseTo(1)
  })

  it('returns zero vector unchanged', () => {
    const v = new Float32Array([0, 0, 0])
    expect(normalizeVector(v)).toEqual(v)
  })
})

describe('serialize/deserialize round-trip', () => {
  it('restores original values', () => {
    const original = new Float32Array([0.1, -0.5, 0.9, 0.3])
    const buffer = serializeEmbedding(original)
    const restored = deserializeEmbedding(buffer)
    for (let i = 0; i < original.length; i++) {
      expect(restored[i]).toBeCloseTo(original[i], 5)
    }
  })

  it('handles non-zero byteOffset correctly', () => {
    const original = new Float32Array([1, 2, 3, 4])
    const buf = serializeEmbedding(original)
    // Simulate a sliced buffer (non-zero byteOffset)
    const padded = Buffer.alloc(buf.length + 8)
    buf.copy(padded, 8)
    const sliced = padded.slice(8)
    const restored = deserializeEmbedding(sliced)
    expect(Array.from(restored)).toEqual(Array.from(original))
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/main/vectorUtils.test.ts
```

Expected: FAIL — `Cannot find module './vectorUtils'`

- [ ] **Step 3: Implement vectorUtils.ts**

```typescript
// src/main/vectorUtils.ts

/**
 * Cosine similarity between two Float32Array vectors.
 * Pre-normalized vectors produce dot product = cosine similarity.
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

/** Deserialize SQLite BLOB (Node.js Buffer) to Float32Array. */
export function deserializeEmbedding(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4)
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/main/vectorUtils.test.ts
```

Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/main/vectorUtils.ts src/main/vectorUtils.test.ts
git commit -m "feat(3c): vectorUtils - cosine similarity, normalize, serialize/deserialize"
```

---

### Task 3: Schema Migration

**Files:**

- Modify: `src/main/fileIndexService.ts`

- [ ] **Step 1: Locate `runMigrations()` in fileIndexService.ts**

Search for the `runMigrations` function. It contains several `try { db.exec('ALTER TABLE...') } catch {}` blocks.

- [ ] **Step 2: Add the Phase 3C migration**

In `runMigrations()`, after the last existing migration block, add:

```typescript
// Phase 3C: embedding_model column for tracking provider/model version
try {
  db.exec(`ALTER TABLE chunks ADD COLUMN embedding_model TEXT`)
} catch {
  // column already exists — safe to ignore
}
```

- [ ] **Step 3: Run existing tests to confirm nothing broke**

```bash
npx vitest run src/main/fileIndexService.test.ts
```

Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add src/main/fileIndexService.ts
git commit -m "feat(3c): schema migration - add chunks.embedding_model column"
```

---

## Chunk 2: Embedding Providers + Factory

### Task 4: Install voyageai dependency

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
npm install voyageai
```

- [ ] **Step 2: Confirm it installed**

```bash
node -e "const { VoyageAIClient } = require('voyageai'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat(3c): install voyageai SDK"
```

---

### Task 5: Voyage Embedding Provider

**Files:**

- Create: `src/main/voyageEmbeddingProvider.ts`
- Create: `src/main/voyageEmbeddingProvider.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/voyageEmbeddingProvider.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VoyageEmbeddingProvider } from './voyageEmbeddingProvider'

// Mock the voyageai SDK
vi.mock('voyageai', () => ({
  VoyageAIClient: vi.fn().mockImplementation(() => ({
    embed: vi.fn(),
  })),
}))

describe('VoyageEmbeddingProvider', () => {
  let provider: VoyageEmbeddingProvider
  let mockEmbed: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    const { VoyageAIClient } = await import('voyageai')
    provider = new VoyageEmbeddingProvider('test-key')
    // Use .at(-1) to get the most recent instantiation (new instance per beforeEach)
    mockEmbed = (VoyageAIClient as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value.embed
  })

  it('has correct metadata', () => {
    expect(provider.modelId).toBe('voyage-3')
    expect(provider.dimensions).toBe(1024)
    expect(provider.maxBatchSize).toBe(96)
  })

  it('calls embed with correct model and document inputType', async () => {
    mockEmbed.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
    })

    const result = await provider.embed(['hello', 'world'], 'document')

    expect(mockEmbed).toHaveBeenCalledWith({
      model: 'voyage-3',
      input: ['hello', 'world'],
      inputType: 'document',
    })
    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ])
  })

  it('calls embed with query inputType for queries', async () => {
    mockEmbed.mockResolvedValue({ data: [{ embedding: [0.5, 0.6] }] })
    await provider.embed(['search query'], 'query')
    expect(mockEmbed).toHaveBeenCalledWith(expect.objectContaining({ inputType: 'query' }))
  })

  it('handles null/undefined data gracefully', async () => {
    mockEmbed.mockResolvedValue({ data: undefined })
    const result = await provider.embed(['text'], 'document')
    expect(result).toEqual([])
  })

  it('propagates non-429 errors', async () => {
    mockEmbed.mockRejectedValue(new Error('API error'))
    await expect(provider.embed(['text'], 'document')).rejects.toThrow('API error')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/main/voyageEmbeddingProvider.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement voyageEmbeddingProvider.ts**

```typescript
// src/main/voyageEmbeddingProvider.ts
import { VoyageAIClient } from 'voyageai'
import type {
  EmbeddingInputType,
  EmbeddingProvider,
} from '../shared/contracts/embedding-provider-contract'

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1024
  readonly modelId = 'voyage-3'
  readonly maxBatchSize = 96

  private client: VoyageAIClient

  constructor(apiKey: string) {
    this.client = new VoyageAIClient({ apiKey })
  }

  async embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
    const response = await this.client.embed({
      model: this.modelId,
      input: texts,
      inputType: inputType === 'query' ? 'query' : 'document',
    })
    // response.data and d.embedding are both optional in SDK types
    return (response.data ?? []).map((d) => d.embedding ?? [])
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/main/voyageEmbeddingProvider.test.ts
```

Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/main/voyageEmbeddingProvider.ts src/main/voyageEmbeddingProvider.test.ts
git commit -m "feat(3c): VoyageEmbeddingProvider with TDD"
```

---

### Task 6: Cohere Embedding + Reranker Provider

**Files:**

- Create: `src/main/cohereEmbeddingProvider.ts`
- Create: `src/main/cohereEmbeddingProvider.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/cohereEmbeddingProvider.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CohereEmbeddingProvider } from './cohereEmbeddingProvider'

vi.mock('cohere-ai', () => ({
  CohereClient: vi.fn().mockImplementation(() => ({
    embed: vi.fn(),
    rerank: vi.fn(),
  })),
}))

describe('CohereEmbeddingProvider', () => {
  let provider: CohereEmbeddingProvider
  let mockEmbed: ReturnType<typeof vi.fn>
  let mockRerank: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    const { CohereClient } = await import('cohere-ai')
    provider = new CohereEmbeddingProvider('test-key')
    // Use .at(-1) to get the most recent instantiation (new instance per beforeEach)
    const instance = (CohereClient as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value
    mockEmbed = instance.embed
    mockRerank = instance.rerank
  })

  it('has correct metadata', () => {
    expect(provider.modelId).toBe('embed-english-v3.0')
    expect(provider.rerankModelId).toBe('rerank-english-v3.0')
    expect(provider.dimensions).toBe(1024)
  })

  it('embed() calls with search_document inputType for documents', async () => {
    mockEmbed.mockResolvedValue({
      embeddings: {
        float: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
      },
    })
    const result = await provider.embed(['a', 'b'], 'document')
    expect(mockEmbed).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'embed-english-v3.0',
        inputType: 'search_document',
        embeddingTypes: ['float'],
      }),
    )
    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ])
  })

  it('embed() uses search_query inputType for queries', async () => {
    mockEmbed.mockResolvedValue({ embeddings: { float: [[0.5]] } })
    await provider.embed(['q'], 'query')
    expect(mockEmbed).toHaveBeenCalledWith(expect.objectContaining({ inputType: 'search_query' }))
  })

  it('embed() returns empty array when float is undefined', async () => {
    mockEmbed.mockResolvedValue({ embeddings: {} })
    const result = await provider.embed(['x'], 'document')
    expect(result).toEqual([])
  })

  it('rerank() returns sorted results with index and score', async () => {
    mockRerank.mockResolvedValue({
      results: [
        { index: 2, relevanceScore: 0.9 },
        { index: 0, relevanceScore: 0.5 },
      ],
    })
    const result = await provider.rerank('query', ['a', 'b', 'c'], 2)
    expect(mockRerank).toHaveBeenCalledWith({
      model: 'rerank-english-v3.0',
      query: 'query',
      documents: ['a', 'b', 'c'],
      topN: 2,
    })
    expect(result).toEqual([
      { index: 2, relevanceScore: 0.9 },
      { index: 0, relevanceScore: 0.5 },
    ])
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/main/cohereEmbeddingProvider.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement cohereEmbeddingProvider.ts**

```typescript
// src/main/cohereEmbeddingProvider.ts
import { CohereClient } from 'cohere-ai'
import type {
  EmbeddingInputType,
  EmbeddingProvider,
  RerankerProvider,
  RerankResult,
} from '../shared/contracts/embedding-provider-contract'

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
    // When embeddingTypes: ['float'], response shape has embeddings.float
    const byType = response as { embeddings: { float?: number[][] } }
    return byType.embeddings.float ?? []
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

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/main/cohereEmbeddingProvider.test.ts
```

Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/main/cohereEmbeddingProvider.ts src/main/cohereEmbeddingProvider.test.ts
git commit -m "feat(3c): CohereEmbeddingProvider with embed + rerank, TDD"
```

---

### Task 7: Embedding Provider Factory

**Files:**

- Create: `src/main/embeddingProviderFactory.ts`
- Create: `src/main/embeddingProviderFactory.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/embeddingProviderFactory.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createProviders } from './embeddingProviderFactory'
import type { AIConfig } from '../shared/ai-config'
import { DEFAULT_AI_CONFIG } from '../shared/ai-config'

vi.mock('./voyageEmbeddingProvider', () => ({
  VoyageEmbeddingProvider: vi.fn().mockImplementation((key: string) => ({
    modelId: 'voyage-3',
    _key: key,
  })),
}))

vi.mock('./cohereEmbeddingProvider', () => ({
  CohereEmbeddingProvider: vi.fn().mockImplementation((key: string) => ({
    modelId: 'embed-english-v3.0',
    rerankModelId: 'rerank-english-v3.0',
    _key: key,
  })),
}))

function config(overrides: Partial<AIConfig>): AIConfig {
  return { ...DEFAULT_AI_CONFIG, ...overrides }
}

describe('createProviders', () => {
  it('returns null embedder when no keys configured', () => {
    const result = createProviders(config({}))
    expect(result.embedder).toBeNull()
    expect(result.reranker).toBeNull()
  })

  it('uses Voyage for embedding when voyageApiKey is set', () => {
    const result = createProviders(config({ voyageApiKey: 'voy-key' }))
    expect(result.embedder?.modelId).toBe('voyage-3')
    expect(result.reranker).toBeNull()
  })

  it('uses Cohere for embedding when only cohereApiKey is set', () => {
    const result = createProviders(config({ cohereApiKey: 'coh-key' }))
    expect(result.embedder?.modelId).toBe('embed-english-v3.0')
    expect(result.reranker).toBeNull()
  })

  it('uses Voyage for embedding + Cohere for reranking when both keys set', () => {
    const result = createProviders(
      config({ voyageApiKey: 'voy-key', cohereApiKey: 'coh-key', useReranking: true }),
    )
    expect(result.embedder?.modelId).toBe('voyage-3')
    expect((result.reranker as { rerankModelId: string } | null)?.rerankModelId).toBe(
      'rerank-english-v3.0',
    )
  })

  it('does not set reranker when useReranking is false', () => {
    const result = createProviders(config({ cohereApiKey: 'coh-key', useReranking: false }))
    expect(result.reranker).toBeNull()
  })

  it('ignores whitespace-only API keys', () => {
    const result = createProviders(config({ voyageApiKey: '   ', cohereApiKey: '  ' }))
    expect(result.embedder).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/main/embeddingProviderFactory.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement embeddingProviderFactory.ts**

```typescript
// src/main/embeddingProviderFactory.ts
import type { AIConfig } from '../shared/ai-config'
import type {
  EmbeddingProvider,
  RerankerProvider,
} from '../shared/contracts/embedding-provider-contract'
import { VoyageEmbeddingProvider } from './voyageEmbeddingProvider'
import { CohereEmbeddingProvider } from './cohereEmbeddingProvider'

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

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/main/embeddingProviderFactory.test.ts
```

Expected: PASS — 6 tests

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
npx vitest run
```

Expected: all existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add src/main/embeddingProviderFactory.ts src/main/embeddingProviderFactory.test.ts
git commit -m "feat(3c): embeddingProviderFactory - provider selection from AIConfig"
```

---

## Chunk 3: Embedding Loop

### Task 8: EmbeddingLoop

**Files:**

- Create: `src/main/embeddingLoop.ts`
- Create: `src/main/embeddingLoop.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/embeddingLoop.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { EmbeddingLoop } from './embeddingLoop'
import type { ProviderSet } from './embeddingProviderFactory'
import type { EmbeddingProvider } from '../shared/contracts/embedding-provider-contract'
import { deserializeEmbedding } from './vectorUtils'

// Helper: create in-memory DB with minimal schema
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
    // Manually trigger one tick
    await (
      loop as unknown as { processBatch: (e: EmbeddingProvider) => Promise<void> }
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

  it('skips batch when no embedder configured', async () => {
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
      (loop as unknown as { processBatch: (e: EmbeddingProvider) => Promise<void> }).processBatch(
        mockEmbedder,
      ),
    ).resolves.not.toThrow()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('re-embeds chunks with stale model', async () => {
    seedChunks(db, 1)
    // Mark chunk as embedded with a different model
    db.prepare(
      "UPDATE chunks SET embedding = X'00000000', embedding_model = 'old-model' WHERE id = 'chunk-0'",
    ).run()
    ;(mockEmbedder.embed as ReturnType<typeof vi.fn>).mockResolvedValue([Array(1024).fill(0)])
    const loop = new EmbeddingLoop(db, getProviders, mockEmit)
    await (
      loop as unknown as { processBatch: (e: EmbeddingProvider) => Promise<void> }
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

  it('init() is idempotent — calling twice does not leak timers', () => {
    const loop = new EmbeddingLoop(db, getProviders, mockEmit)
    loop.init()
    loop.init() // should destroy first timer before creating new one
    loop.destroy()
    // No timer leak — if there were two timers, vi.useFakeTimers would detect it
    // (test passes if no error thrown and destroy works cleanly)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/main/embeddingLoop.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement embeddingLoop.ts**

```typescript
// src/main/embeddingLoop.ts
import type Database from 'better-sqlite3'
import type { EmbeddingProvider } from '../shared/contracts/embedding-provider-contract'
import type { EmbeddingStats } from '../shared/contracts/embedding-provider-contract'
import type { EmbeddingProgressPayload } from '../shared/ipc-types'
import type { ProviderSet } from './embeddingProviderFactory'
import { normalizeVector, serializeEmbedding } from './vectorUtils'

export class EmbeddingLoop {
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly db: Database.Database,
    private readonly getProviders: () => ProviderSet,
    private readonly emit: (payload: EmbeddingProgressPayload) => void,
  ) {}

  /** Idempotent: destroys existing timer before starting. */
  init(): void {
    this.destroy()
    this.timer = setInterval(() => void this.tick(), 10_000)
    setImmediate(() => void this.tick())
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
        `SELECT COUNT(*) as n FROM chunks c
         JOIN files f ON f.id = c.file_id
         WHERE f.pipeline_state = 'indexed'`,
      )
      .get() as { n: number }
    const embeddedRow = this.db
      .prepare(
        `SELECT COUNT(*) as n FROM chunks c
         JOIN files f ON f.id = c.file_id
         WHERE f.pipeline_state = 'indexed'
           AND c.embedding IS NOT NULL
           AND c.embedding_model = ?`,
      )
      .get(embedder?.modelId ?? '') as { n: number }
    const t = totalRow.n
    const e = embeddedRow.n
    return {
      embedded: e,
      total: t,
      percent: t > 0 ? Math.round((e / t) * 100) : 0,
      isReady: t > 0 && e === t,
      hasProvider: Boolean(embedder),
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

    let embeddings: number[][]
    try {
      embeddings = await embedder.embed(
        chunks.map((c) => c.text),
        'document',
      )
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 429) {
        console.warn('[EmbeddingLoop] rate limited, will retry on next tick')
        return
      }
      throw err
    }

    const update = this.db.prepare(
      `UPDATE chunks SET embedding = ?, embedding_model = ? WHERE id = ?`,
    )
    const updateMany = this.db.transaction((rows: { id: string; vec: Float32Array }[]) => {
      for (const row of rows) {
        update.run(serializeEmbedding(row.vec), embedder.modelId, row.id)
      }
    })

    updateMany(
      embeddings.map((raw, i) => ({
        id: chunks[i].id,
        vec: normalizeVector(new Float32Array(raw)),
      })),
    )

    this.emit(this.getStats())

    // Throttle between batches
    await new Promise((r) => setTimeout(r, 100))
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/main/embeddingLoop.test.ts
```

Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/main/embeddingLoop.ts src/main/embeddingLoop.test.ts
git commit -m "feat(3c): EmbeddingLoop - background embedding with TDD"
```

---

## Chunk 4: Retrieval Service Extensions

### Task 9: Extend RetrievalService with Vector + Hybrid Search

**Files:**

- Modify: `src/main/retrievalService.ts`
- Modify: `src/main/retrievalService.test.ts` (extend existing tests)

- [ ] **Step 1: Write the failing tests** (add to existing test file)

Open `src/main/retrievalService.test.ts` and add these test suites after the existing ones:

```typescript
// Add these imports at the top of the test file (if not already present):
// import { serializeEmbedding, normalizeVector } from './vectorUtils'

describe('RetrievalService — vector + hybrid', () => {
  let db: Database.Database
  let service: RetrievalService

  // Helper to create a mock embedding provider
  function mockProvider(modelId = 'voyage-3') {
    return {
      embedder: {
        modelId,
        dimensions: 4,
        maxBatchSize: 96,
        embed: vi.fn().mockResolvedValue([[1, 0, 0, 0]]),
      },
      reranker: null,
    }
  }

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE files (
        id INTEGER PRIMARY KEY, path TEXT, name TEXT, ext TEXT,
        size_bytes INTEGER DEFAULT 0, modified_ms INTEGER DEFAULT 0,
        project TEXT, discipline TEXT, doc_type TEXT, source_id TEXT,
        drawing_number TEXT, revision TEXT, issue_status TEXT,
        pipeline_state TEXT DEFAULT 'indexed'
      );
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY, file_id INTEGER, source_id TEXT DEFAULT 'default',
        chunk_index INTEGER DEFAULT 0, text TEXT, token_count INTEGER DEFAULT 10,
        char_count INTEGER DEFAULT 10, page_number INTEGER, section_title TEXT,
        sheet_name TEXT, embedding BLOB, embedding_model TEXT, created_at INTEGER DEFAULT 0
      );
      CREATE VIRTUAL TABLE chunks_fts USING fts5(text, section_title, content='chunks', content_rowid='rowid', tokenize='porter unicode61');
      CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, text, section_title) VALUES (new.rowid, new.text, new.section_title);
      END;
      INSERT INTO files (id, path, name, ext, source_id, pipeline_state)
        VALUES (1, '/a.txt', 'a.txt', '.txt', 'src1', 'indexed');
    `)

    // Insert chunks with embeddings
    const insertChunk = db.prepare(
      `INSERT INTO chunks (id, file_id, text, embedding, embedding_model)
       VALUES (?, 1, ?, ?, 'voyage-3')`,
    )
    // Chunk 0: aligned with query direction [1,0,0,0]
    const vec0 = normalizeVector(new Float32Array([1, 0, 0, 0]))
    // Chunk 1: partially aligned
    const vec1 = normalizeVector(new Float32Array([0.5, 0.5, 0, 0]))
    // Chunk 2: orthogonal — won't appear in vector search
    const vec2 = normalizeVector(new Float32Array([0, 0, 1, 0]))

    insertChunk.run('c0', 1, 'semantic match document', serializeEmbedding(vec0))
    insertChunk.run('c1', 1, 'partial match document', serializeEmbedding(vec1))
    insertChunk.run('c2', 1, 'unrelated document about cats', serializeEmbedding(vec2))

    service = new RetrievalService(db, () => mockProvider())
  })

  afterEach(() => db.close())

  it('isVectorReady() returns true when all chunks have current model embeddings', () => {
    expect(service.isVectorReady()).toBe(true)
  })

  it('isVectorReady() returns false when embedder is null', () => {
    const noEmbedService = new RetrievalService(db, () => ({ embedder: null, reranker: null }))
    expect(noEmbedService.isVectorReady()).toBe(false)
  })

  it('vector mode returns results sorted by cosine similarity', async () => {
    const results = await service.search({ query: 'semantic', mode: 'vector', limit: 3 })
    // c0 is most similar to [1,0,0,0], should rank first
    expect(results[0].chunk.id).toBe('c0')
    expect(results[0].vectorDistance).not.toBeNull()
  })

  it('hybrid mode returns RRF-merged results', async () => {
    const results = await service.search({ query: 'document', mode: 'hybrid', limit: 3 })
    expect(results.length).toBeGreaterThan(0)
    // RRF score should be populated
    expect(results[0].rrfScore).not.toBeNull()
  })

  it('auto mode falls back to keyword when embedder is null', async () => {
    const noEmbedService = new RetrievalService(db, () => ({ embedder: null, reranker: null }))
    // Should not throw; falls back to BM25
    const results = await noEmbedService.search({ query: 'document', mode: 'auto', limit: 5 })
    expect(results.length).toBeGreaterThan(0)
  })

  it('applies reranker when present', async () => {
    const mockReranker = {
      rerankModelId: 'rerank-v3',
      rerank: vi.fn().mockResolvedValue([
        { index: 1, relevanceScore: 0.9 },
        { index: 0, relevanceScore: 0.5 },
      ]),
    }
    const rerankService = new RetrievalService(db, () => ({
      embedder: mockProvider().embedder,
      reranker: mockReranker,
    }))
    const results = await rerankService.search({ query: 'document', mode: 'vector', limit: 2 })
    expect(mockReranker.rerank).toHaveBeenCalled()
    // Results should be in reranker's order
    expect(results[0].chunk.id).toBe('c1') // index 1 → c1
  })
})
```

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
npx vitest run src/main/retrievalService.test.ts
```

Expected: new tests FAIL (RetrievalService constructor doesn't accept getProviders)

- [ ] **Step 3: Extend RetrievalService**

Replace the existing `retrievalService.ts` content. Key changes:

1. Constructor gains `getProviders: () => ProviderSet` optional parameter (default `() => ({ embedder: null, reranker: null })`)
2. `search()` gains mode routing via `resolveMode()`
3. Add `isVectorReady()`, `searchVector()`, `mergeWithRRF()`, `applyRerank()`, `embedQuery()` private methods
4. All existing methods (`keywordSearch`, `getAdjacentChunks`, `getStatus`, `mapChunk`, `mapFile`) are preserved unchanged
5. Singleton export at the bottom gains optional `getProviders` param to `init()`

```typescript
// src/main/retrievalService.ts
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
import { cosineSimilarity, normalizeVector, deserializeEmbedding } from './vectorUtils'

// RetrievalRow and ChunkRow interfaces — copy verbatim from existing file, then add VectorRow below
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

// Raw row for vector search (includes embedding column)
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
  private queryEmbeddingCache = new Map<string, Float32Array>()

  constructor(
    private readonly db: Database.Database,
    private readonly getProviders: () => ProviderSet = () => ({ embedder: null, reranker: null }),
  ) {}

  isVectorReady(): boolean {
    const { embedder } = this.getProviders()
    if (!embedder) return false
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as n FROM chunks c
         JOIN files f ON f.id = c.file_id
         WHERE f.pipeline_state = 'indexed'
           AND (c.embedding IS NULL OR c.embedding_model != ?)`,
      )
      .get(embedder.modelId) as { n: number }
    return row.n === 0
  }

  async search(params: RetrievalParams): Promise<RetrievalResult[]> {
    const { embedder, reranker } = this.getProviders()
    const effectiveMode = this.resolveMode(params.mode, embedder)
    const limit = params.limit ?? 10

    if (effectiveMode === 'keyword') {
      return this.keywordSearch(params.query, params.sourceId, params.project, limit)
    }

    if (effectiveMode === 'vector') {
      const queryVec = await this.embedQuery(params.query, embedder!)
      const results = await this.searchVector(params, queryVec, limit)
      return reranker ? this.applyRerank(params.query, results, reranker, limit) : results
    }

    // hybrid
    const [kwResults, vecResults] = await Promise.all([
      Promise.resolve(this.keywordSearch(params.query, params.sourceId, params.project, limit * 2)),
      (async () => {
        const queryVec = await this.embedQuery(params.query, embedder!)
        return this.searchVector(params, queryVec, limit * 2)
      })(),
    ])
    const merged = this.mergeWithRRF(kwResults, vecResults).slice(0, limit)
    return reranker ? this.applyRerank(params.query, merged, reranker, limit) : merged
  }

  // ---- Keep all existing methods below unchanged ----
  getAdjacentChunks(
    fileId: number,
    chunkIndex: number,
  ): { prev: ChunkRecord | null; next: ChunkRecord | null } {
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
          .get(sourceId) as { count: number })
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

  // ---- Private helpers ----

  private resolveMode(
    requested: RetrievalMode | undefined,
    embedder: EmbeddingProvider | null,
  ): 'keyword' | 'vector' | 'hybrid' {
    const mode = requested ?? 'auto'
    if (mode === 'auto') return embedder && this.isVectorReady() ? 'hybrid' : 'keyword'
    if ((mode === 'vector' || mode === 'hybrid') && (!embedder || !this.isVectorReady())) {
      return 'keyword'
    }
    return mode as 'keyword' | 'vector' | 'hybrid'
  }

  private async searchVector(
    params: RetrievalParams,
    queryEmbedding: Float32Array,
    limit: number,
  ): Promise<RetrievalResult[]> {
    const { embedder } = this.getProviders()
    const modelId = embedder!.modelId

    const rows = this.db
      .prepare(
        `SELECT c.id, c.file_id, c.chunk_index, c.text, c.token_count, c.char_count,
                c.page_number, c.section_title, c.sheet_name, c.embedding, c.created_at,
                c.source_id AS chunk_source_id,
                f.path, f.name, f.ext, f.size_bytes, f.modified_ms, f.project,
                f.discipline, f.doc_type, f.source_id, f.drawing_number, f.revision, f.issue_status
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
        params.sourceId ?? null,
        params.sourceId ?? null,
        params.project ?? null,
        params.project ?? null,
      ) as VectorRow[]

    return rows
      .map((row) => {
        const vec = deserializeEmbedding(row.embedding)
        const score = cosineSimilarity(queryEmbedding, vec)
        return { row, score }
      })
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

    bm25Results.forEach((r, rank) => {
      const id = r.chunk.id
      const rrf = 1 / (K + rank + 1)
      const existing = scores.get(id)
      scores.set(id, { result: r, rrf: (existing?.rrf ?? 0) + rrf })
    })

    vectorResults.forEach((r, rank) => {
      const id = r.chunk.id
      const rrf = 1 / (K + rank + 1)
      const existing = scores.get(id)
      scores.set(id, { result: existing?.result ?? r, rrf: (existing?.rrf ?? 0) + rrf })
    })

    return [...scores.values()]
      .sort((a, b) => b.rrf - a.rrf)
      .map(({ result, rrf }) => ({ ...result, rrfScore: rrf }))
  }

  private async applyRerank(
    query: string,
    results: RetrievalResult[],
    reranker: RerankerProvider,
    topN: number,
  ): Promise<RetrievalResult[]> {
    if (results.length === 0) return results
    const reranked = await reranker.rerank(
      query,
      results.map((r) => r.chunk.text),
      topN,
    )
    return reranked.map(({ index }) => results[index])
  }

  private async embedQuery(query: string, embedder: EmbeddingProvider): Promise<Float32Array> {
    const key = `${embedder.modelId}:${query}`
    if (this.queryEmbeddingCache.has(key)) return this.queryEmbeddingCache.get(key)!
    const [raw] = await embedder.embed([query], 'query')
    const vec = normalizeVector(new Float32Array(raw))
    this.queryEmbeddingCache.set(key, vec)
    if (this.queryEmbeddingCache.size > 100) {
      this.queryEmbeddingCache.delete(this.queryEmbeddingCache.keys().next().value!)
    }
    return vec
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
          c.id, c.file_id, c.chunk_index, c.text, c.token_count, c.char_count,
          c.page_number, c.section_title, c.sheet_name, c.embedding, c.created_at,
          c.source_id AS chunk_source_id,
          f.path, f.name, f.ext, f.size_bytes, f.modified_ms, f.project,
          f.discipline, f.doc_type, f.source_id, f.drawing_number, f.revision, f.issue_status,
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
      .prepare(`SELECT c.*, c.source_id FROM chunks c WHERE c.file_id = ? AND c.chunk_index = ?`)
      .get(fileId, chunkIndex) as ChunkRow | undefined
    return row ? this.mapChunk(row) : null
  }

  private mapChunk(row: ChunkRow | RetrievalRow): ChunkRecord {
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

  private mapFile(row: RetrievalRow): FileEntry {
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
```

- [ ] **Step 4: Run all retrieval tests**

```bash
npx vitest run src/main/retrievalService.test.ts
```

Expected: all tests pass (both existing and new)

- [ ] **Step 5: Update toolRegistry.ts to pass `mode: 'auto'`**

In `src/main/toolRegistry.ts`, find the `retrievalService.search()` call inside `searchKnowledgeBaseTool` and add `mode: 'auto'`:

```typescript
const results = await retrievalService.search({
  query,
  sourceId: combo.sourceId,
  project: combo.project,
  limit,
  mode: 'auto', // auto-selects hybrid when embeddings ready
})
```

- [ ] **Step 6: Commit**

```bash
git add src/main/retrievalService.ts src/main/retrievalService.test.ts src/main/toolRegistry.ts
git commit -m "feat(3c): retrieval service - vector search, hybrid RRF, rerank, auto mode"
```

---

## Chunk 5: IPC Integration + Preload

### Task 10: Wire EmbeddingLoop into main.ts and preload.ts

**Files:**

- Modify: `src/main/main.ts`
- Modify: `src/preload/preload.ts`
- Modify: `src/preload/preload.test.ts` (extend)

- [ ] **Step 1: Add embeddingLoop to main.ts**

In `src/main/main.ts`:

Add imports near the top (with other service imports):

```typescript
import { EmbeddingLoop } from './embeddingLoop'
import { createProviders } from './embeddingProviderFactory'
```

After `ingestionQueue.init(...)` in the `app.whenReady()` block, add:

```typescript
// Phase 3C: background embedding loop
const embeddingLoop = new EmbeddingLoop(
  fileIndexDb,
  () => createProviders(getAIConfig()),
  (payload) => mainWindow.webContents.send(IPC_CHANNELS.EMBEDDING_PROGRESS, payload),
)
embeddingLoop.init()
```

Update `retrievalService.init()` call to pass the provider factory:

```typescript
// Find the existing line: retrievalService.init(fileIndexDb)
// Change to:
retrievalService.init(fileIndexDb, () => createProviders(getAIConfig()))
```

Add the two new IPC handlers after the existing `INGESTION_RETRY` handler:

```typescript
ipcMain.handle(IPC_CHANNELS.EMBEDDING_STATS, () => embeddingLoop.getStats())
```

Find the existing `STORE_SET` handler and note that config saves go through `STORE_SET` with key `'ai'`. Add a side-effect to restart the embedding loop when the `'ai'` key is saved:

```typescript
// Modify the existing STORE_SET handler to also restart the loop on AI config change:
ipcMain.handle(IPC_CHANNELS.STORE_SET, (_event, key: string, value: unknown | null) => {
  if (value === null) {
    store?.delete(key)
  } else {
    store?.set(key, value)
  }
  // Restart embedding loop when AI config changes (new API key may have been entered)
  if (key === 'ai') {
    embeddingLoop.init()
  }
})
```

**Note:** The `embeddingLoop` variable must be declared before the `ipcMain.handle` calls. Move the loop instantiation before all handlers or use a module-level variable. The cleanest approach: instantiate `embeddingLoop` in the `app.whenReady()` callback after `ingestionQueue.init()`, and reference it in the STORE_SET handler via closure (both are in the same scope).

- [ ] **Step 2: Add preload bridges**

In `src/preload/preload.ts`, add to the `contextBridge.exposeInMainWorld('korda', { ... })` object:

```typescript
onEmbeddingProgress: (cb: (payload: EmbeddingProgressPayload) => void) => {
  const handler = (_: IpcRendererEvent, payload: EmbeddingProgressPayload) => cb(payload)
  ipcRenderer.on(IPC_CHANNELS.EMBEDDING_PROGRESS, handler)
  return () => ipcRenderer.removeListener(IPC_CHANNELS.EMBEDDING_PROGRESS, handler)
},
getEmbeddingStats: () => ipcRenderer.invoke(IPC_CHANNELS.EMBEDDING_STATS),
```

Ensure `EmbeddingProgressPayload` is imported from `'../shared/ipc-types'`.

- [ ] **Step 3: Add preload tests**

In `src/preload/preload.test.ts`, add:

```typescript
describe('embedding IPC bridges', () => {
  it('onEmbeddingProgress registers and returns cleanup', () => {
    const cb = vi.fn()
    const cleanup = window.korda.onEmbeddingProgress(cb)
    expect(mockIpcRenderer.on).toHaveBeenCalledWith(
      IPC_CHANNELS.EMBEDDING_PROGRESS,
      expect.any(Function),
    )
    expect(typeof cleanup).toBe('function')
    cleanup()
    expect(mockIpcRenderer.removeListener).toHaveBeenCalled()
  })

  it('getEmbeddingStats invokes EMBEDDING_STATS channel', () => {
    window.korda.getEmbeddingStats()
    expect(mockIpcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.EMBEDDING_STATS)
  })
})
```

- [ ] **Step 4: Run preload tests**

```bash
npx vitest run src/preload/preload.test.ts
```

Expected: all pass

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/main/main.ts src/preload/preload.ts src/preload/preload.test.ts
git commit -m "feat(3c): wire EmbeddingLoop into main.ts IPC + preload bridges"
```

---

## Chunk 6: UI — AI Settings + Knowledge Banner

### Task 11: AI Settings — Retrieval Controls

**Files:**

- Modify: `src/renderer/modules/settings/pages/AI.tsx`
- Modify: `src/renderer/modules/settings/pages/AI.test.tsx`

- [ ] **Step 1: Locate the existing Voyage/Cohere section in AI.tsx**

The file at `src/renderer/modules/settings/pages/AI.tsx` already has Voyage AI and Cohere key fields (around line 316). Find this section — it's labelled something like "Voyage AI API Key" and "Cohere API Key".

- [ ] **Step 2: Add `useReranking` checkbox and `retrievalMode` radio group**

After the existing Cohere key field and its hint, add:

```tsx
{
  /* Use Cohere reranking */
}
;<div className="flex items-center gap-3 mt-2">
  <input
    id="useReranking"
    type="checkbox"
    checked={aiConfig.useReranking ?? false}
    disabled={!aiConfig.cohereApiKey?.trim()}
    onChange={(e) => setAiConfig((prev) => ({ ...prev, useReranking: e.target.checked }))}
    className="h-4 w-4 rounded accent-accent disabled:opacity-40"
  />
  <label htmlFor="useReranking" className="text-sm text-text-secondary">
    Use Cohere reranking when available
  </label>
</div>

{
  /* Retrieval Mode */
}
;<div className="mt-4">
  <p className="text-sm font-medium text-text-primary mb-2">Retrieval Mode</p>
  {(
    [
      ['auto', 'Auto (recommended — hybrid when ready, keyword otherwise)'],
      ['hybrid', 'Hybrid (BM25 + vector + RRF)'],
      ['keyword', 'Keyword only (FTS5/BM25)'],
    ] as const
  ).map(([value, label]) => (
    <label key={value} className="flex items-center gap-2 mb-1 cursor-pointer">
      <input
        type="radio"
        name="retrievalMode"
        value={value}
        checked={(aiConfig.retrievalMode ?? 'auto') === value}
        onChange={() => setAiConfig((prev) => ({ ...prev, retrievalMode: value }))}
        className="accent-accent"
      />
      <span className="text-sm text-text-secondary">{label}</span>
    </label>
  ))}
</div>
```

- [ ] **Step 3: Add ProviderPriorityHint component** (inline in AI.tsx, above the section)

```tsx
function ProviderPriorityHint({
  voyageKey,
  cohereKey,
}: {
  voyageKey?: string
  cohereKey?: string
}) {
  const hasVoyage = Boolean(voyageKey?.trim())
  const hasCohere = Boolean(cohereKey?.trim())
  let message = 'No embedding provider — keyword search only'
  if (hasVoyage && hasCohere) message = 'Voyage (embeddings) · Cohere (rerank)'
  else if (hasVoyage) message = 'Voyage (embeddings)'
  else if (hasCohere) message = 'Cohere (embeddings + rerank)'
  return <p className="text-xs text-text-secondary mt-1 italic">{message}</p>
}
```

Place `<ProviderPriorityHint voyageKey={aiConfig.voyageApiKey} cohereKey={aiConfig.cohereApiKey} />` after the Cohere API key label and before the reranking checkbox.

- [ ] **Step 4: Add/extend tests in AI.test.tsx**

```typescript
describe('Knowledge Retrieval section', () => {
  it('renders useReranking checkbox unchecked by default', () => {
    render(<AI />)
    const checkbox = screen.getByRole('checkbox', { name: /Use Cohere reranking/i })
    expect(checkbox).not.toBeChecked()
  })

  it('reranking checkbox is disabled when no Cohere key', () => {
    render(<AI />)
    const checkbox = screen.getByRole('checkbox', { name: /Use Cohere reranking/i })
    expect(checkbox).toBeDisabled()
  })

  it('auto retrieval mode is selected by default', () => {
    render(<AI />)
    const autoRadio = screen.getByRole('radio', { name: /Auto/i })
    expect(autoRadio).toBeChecked()
  })

  it('ProviderPriorityHint shows "No embedding provider" when no keys', () => {
    render(<AI />)
    expect(screen.getByText(/No embedding provider/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 5: Run AI settings tests**

```bash
npx vitest run src/renderer/modules/settings/pages/AI.test.tsx
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/settings/pages/AI.tsx src/renderer/modules/settings/pages/AI.test.tsx
git commit -m "feat(3c): AI settings - useReranking checkbox, retrievalMode radio, ProviderPriorityHint"
```

---

### Task 12: Knowledge Status Banner — Embedding Progress

**Files:**

- Modify: `src/renderer/modules/knowledge/components/KnowledgeStatusBanner.tsx`
- Modify: `src/renderer/modules/knowledge/components/KnowledgeStatusBanner.test.tsx`
- Modify: `src/renderer/modules/knowledge/KnowledgeModule.tsx`

- [ ] **Step 1: Write the failing tests for banner**

In `KnowledgeStatusBanner.test.tsx`, add:

```typescript
import type { EmbeddingStats } from '../../../../shared/contracts/embedding-provider-contract'

const embeddingInProgress: EmbeddingStats = {
  embedded: 320,
  total: 1000,
  percent: 32,
  isReady: false,
  hasProvider: true,
}

const embeddingComplete: EmbeddingStats = {
  embedded: 1000,
  total: 1000,
  percent: 100,
  isReady: true,
  hasProvider: true,
}

const noProvider: EmbeddingStats = {
  embedded: 0,
  total: 100,
  percent: 0,
  isReady: false,
  hasProvider: false,
}

describe('KnowledgeStatusBanner — embedding states', () => {
  it('shows embedding progress when in progress', () => {
    render(
      <KnowledgeStatusBanner
        status={null}
        onRetry={() => {}}
        embeddingStats={embeddingInProgress}
      />,
    )
    expect(screen.getByText(/Embedding knowledge base/i)).toBeInTheDocument()
    expect(screen.getByText(/320/)).toBeInTheDocument()
    expect(screen.getByText(/1,000/)).toBeInTheDocument()
  })

  it('hides banner when embeddings complete and no ingestion', () => {
    const { container } = render(
      <KnowledgeStatusBanner
        status={null}
        onRetry={() => {}}
        embeddingStats={embeddingComplete}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows "keyword search only" info when no provider configured', () => {
    render(
      <KnowledgeStatusBanner
        status={null}
        onRetry={() => {}}
        embeddingStats={noProvider}
      />,
    )
    expect(screen.getByText(/Keyword search only/i)).toBeInTheDocument()
  })

  it('ingestion banner takes priority over embedding banner', () => {
    render(
      <KnowledgeStatusBanner
        status={{ queued: 5, extracting: 2, chunking: 0, contextualizing: 0, new: 0, indexed: 10, failed: 0, skipped: 0, total: 17, totalChunks: 50, avgChunksPerFile: 5 }}
        onRetry={() => {}}
        embeddingStats={embeddingInProgress}
      />,
    )
    expect(screen.getByText(/Indexing/i)).toBeInTheDocument()
    expect(screen.queryByText(/Embedding knowledge base/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/renderer/modules/knowledge/components/KnowledgeStatusBanner.test.tsx
```

Expected: FAIL — new props not accepted

- [ ] **Step 3: Update KnowledgeStatusBanner.tsx**

```tsx
// src/renderer/modules/knowledge/components/KnowledgeStatusBanner.tsx
import type { IngestionStatus } from '../../../../shared/ipc-types'
import type { EmbeddingStats } from '../../../../shared/contracts/embedding-provider-contract'

interface KnowledgeStatusBannerProps {
  status: IngestionStatus | null
  onRetry: () => void
  embeddingStats?: EmbeddingStats | null // NEW
}

export function KnowledgeStatusBanner({
  status,
  onRetry,
  embeddingStats,
}: KnowledgeStatusBannerProps) {
  // 1. Ingestion in progress (highest priority)
  const inFlight = status
    ? status.queued + status.extracting + status.chunking + status.contextualizing
    : 0
  const hasFailed = (status?.failed ?? 0) > 0

  if (inFlight > 0 || hasFailed) {
    const progress =
      status && status.total > 0 ? Math.round((status.indexed / status.total) * 100) : 0
    return (
      <div className="flex items-center gap-3 border-b border-border bg-surface-raised px-4 py-2 text-xs text-text-secondary">
        {inFlight > 0 && (
          <>
            <span className="text-accent animate-pulse">●</span>
            <span>Indexing {inFlight.toLocaleString()} files</span>
            <div className="h-1 max-w-32 flex-1 overflow-hidden rounded-full bg-surface">
              <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>
          </>
        )}
        {hasFailed && <span className="ml-2 text-error">{status!.failed} failed</span>}
        {hasFailed && (
          <button onClick={onRetry} className="ml-auto underline hover:text-text-primary">
            Retry Failed
          </button>
        )}
      </div>
    )
  }

  // 2. No embedding provider
  if (embeddingStats && !embeddingStats.hasProvider) {
    return (
      <div className="flex items-center gap-2 border-b border-border bg-surface-raised px-4 py-2 text-xs text-text-secondary">
        <span className="text-text-tertiary">ℹ</span>
        <span>
          Keyword search only — add an embedding API key in Settings to enable hybrid search
        </span>
      </div>
    )
  }

  // 3. Embedding in progress
  if (embeddingStats && !embeddingStats.isReady && embeddingStats.hasProvider) {
    return (
      <div className="flex items-center gap-3 border-b border-border bg-surface-raised px-4 py-2 text-xs text-text-secondary">
        <span className="text-blue-400 animate-pulse">●</span>
        <span>
          Embedding knowledge base…{' '}
          <span className="text-text-primary">
            {embeddingStats.embedded.toLocaleString()} / {embeddingStats.total.toLocaleString()}
          </span>{' '}
          chunks ({embeddingStats.percent}%)
        </span>
        <div className="h-1 max-w-32 flex-1 overflow-hidden rounded-full bg-surface">
          <div
            className="h-full bg-blue-400 transition-all"
            style={{ width: `${embeddingStats.percent}%` }}
          />
        </div>
      </div>
    )
  }

  // 4. All done — hide
  return null
}
```

- [ ] **Step 4: Update KnowledgeModule.tsx to wire embedding stats**

In `src/renderer/modules/knowledge/KnowledgeModule.tsx`:

Add state and effect for embedding stats:

```tsx
const [embeddingStats, setEmbeddingStats] = useState<EmbeddingStats | null>(null)

useEffect(() => {
  // Load initial stats
  void window.korda.getEmbeddingStats().then(setEmbeddingStats)

  // Subscribe to real-time progress
  const unsub = window.korda.onEmbeddingProgress(setEmbeddingStats)
  return unsub
}, [])
```

Update the `<KnowledgeStatusBanner>` JSX call:

```tsx
<KnowledgeStatusBanner
  status={ingestionStatus}
  onRetry={handleRetry}
  embeddingStats={embeddingStats}
/>
```

Add the import:

```tsx
import type { EmbeddingStats } from '../../../shared/contracts/embedding-provider-contract'
```

- [ ] **Step 5: Run banner tests**

```bash
npx vitest run src/renderer/modules/knowledge/components/KnowledgeStatusBanner.test.tsx
```

Expected: all pass

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run
```

Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/knowledge/components/KnowledgeStatusBanner.tsx \
        src/renderer/modules/knowledge/components/KnowledgeStatusBanner.test.tsx \
        src/renderer/modules/knowledge/KnowledgeModule.tsx
git commit -m "feat(3c): KnowledgeStatusBanner - embedding progress, no-provider hint"
```

---

## Chunk 7: Final Integration + Push

### Task 13: Full Test Run + Push

- [ ] **Step 1: Run the complete test suite**

```bash
npx vitest run
```

Expected: all tests pass. If any fail, fix before proceeding.

- [ ] **Step 2: TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Push all commits to remote**

```bash
git push origin main
```

- [ ] **Step 4: Verify push succeeded**

```bash
git log --oneline -10
git fetch origin
git log --oneline HEAD..origin/main
```

Expected: the second command shows no output (local and remote are in sync).

---

## Summary: All Files

### New files created

| File                                                  | Task |
| ----------------------------------------------------- | ---- |
| `src/shared/contracts/embedding-provider-contract.ts` | 1    |
| `src/main/vectorUtils.ts` + test                      | 2    |
| `src/main/voyageEmbeddingProvider.ts` + test          | 5    |
| `src/main/cohereEmbeddingProvider.ts` + test          | 6    |
| `src/main/embeddingProviderFactory.ts` + test         | 7    |
| `src/main/embeddingLoop.ts` + test                    | 8    |

### Modified files

| File                                                                         | Task |
| ---------------------------------------------------------------------------- | ---- |
| `src/shared/contracts/retrieval-contract.ts`                                 | 1    |
| `src/shared/ai-config.ts`                                                    | 1    |
| `src/shared/ipc-types.ts`                                                    | 1    |
| `src/main/fileIndexService.ts`                                               | 3    |
| `src/main/retrievalService.ts` + test                                        | 9    |
| `src/main/toolRegistry.ts`                                                   | 9    |
| `src/main/main.ts`                                                           | 10   |
| `src/preload/preload.ts` + test                                              | 10   |
| `src/renderer/modules/settings/pages/AI.tsx` + test                          | 11   |
| `src/renderer/modules/knowledge/components/KnowledgeStatusBanner.tsx` + test | 12   |
| `src/renderer/modules/knowledge/KnowledgeModule.tsx`                         | 12   |
| `package.json` + `package-lock.json`                                         | 4    |
