# Phase 3C: Semantic Search — Codex Handoff Prompt

> Paste everything below the horizontal rule into Codex.

---

## Your Task

Implement **Phase 3C: Semantic Search** for Korda Studio — an Electron + React + SQLite desktop app for AI-assisted music production workflows.

You are implementing a full vector-embedding pipeline on top of an existing BM25/FTS5 keyword search foundation (Phase 3A) and grounded chat (Phase 3B). When complete, the app will embed knowledge-base chunks in the background using Voyage AI or Cohere, then use hybrid BM25+vector retrieval with Reciprocal Rank Fusion (and optional Cohere reranking) to find semantically relevant content even when exact keywords don't match.

**Everything must degrade gracefully:** no API key → keyword-only search, partial embeddings → keyword-only, all embedded → hybrid.

---

## Read These First

Before writing any code, read these documents in full:

1. **Spec:** `docs/superpowers/specs/2026-03-24-korda-studio-phase3c-semantic-search-design.md`
2. **Plan:** `docs/superpowers/plans/2026-03-24-korda-studio-phase3c-semantic-search.md`

The plan is the authoritative source of truth. Follow it exactly — every step, every file path, every code snippet. The spec provides deeper context when the plan is ambiguous.

---

## Key Technical Facts

### Stack

- **Electron** (main process) + **React** (renderer) + **SQLite** via `better-sqlite3`
- **Vitest** for tests (not Jest)
- **TypeScript** throughout
- `cohere-ai` is already installed (v7.20.0)
- `voyageai` is **NOT installed** — Task 4 in the plan installs it

### Embedding Storage

- `chunks` table already has an `embedding` column (`BLOB`) — used in Phase 3A but always NULL
- Add `embedding_model TEXT` column via migration in `src/main/fileIndexService.ts`
- Store as `Float32Array` serialized to `Buffer`: `Buffer.from(vec.buffer)`
- Deserialize: `new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4)`
- All vectors are L2-normalized before storage

### Provider SDKs

**Voyage AI:**

```typescript
import { VoyageAIClient } from 'voyageai' // named export, NOT default
const client = new VoyageAIClient({ apiKey })
const response = await client.embed({ input: texts, model: 'voyage-3', inputType })
const embeddings = (response.data ?? []).map((d) => d.embedding ?? [])
```

**Cohere:**

```typescript
import { CohereClient } from 'cohere-ai'
const client = new CohereClient({ token: apiKey })
const response = await client.embed({
  texts,
  model: 'embed-english-v3.0',
  inputType: 'search_document',
  embeddingTypes: ['float'],
})
const embeddings = (response as { embeddings: { float?: number[][] } }).embeddings.float ?? []
// Reranking:
const result = await client.rerank({ model: 'rerank-english-v3.0', query, documents, topN })
```

### Provider Priority

- Voyage API key present → use `VoyageEmbeddingProvider` for embeddings
- No Voyage, Cohere key present → use `CohereEmbeddingProvider` for embeddings
- Cohere key present + `useReranking: true` → use `CohereEmbeddingProvider` for reranking (regardless of embedding provider)
- Neither → `null` embedder → keyword-only search

### EmbeddingLoop Behavior

- Background loop in main process, `setInterval` every 10 seconds
- Batch size: 32 chunks per tick
- 100ms throttle between batches
- 429 rate-limit → exponential backoff (start 5s, max 60s)
- `init()` calls `this.destroy()` first (idempotent)
- Emits `EMBEDDING_PROGRESS` IPC to renderer after each batch

### Hybrid Retrieval (RRF)

```typescript
// Reciprocal Rank Fusion — K=60, rank is 0-indexed
score = 1 / (60 + rank + 1)
// Final score = bm25_rrf_score + vector_rrf_score
```

- BM25 results: top 20 via FTS5 (existing `searchKeyword`)
- Vector results: top 20 via cosine similarity brute-force over all embedded chunks
- Merge via RRF → top `limit` results

### `isVectorReady()`

Returns `true` when: `SELECT COUNT(*) FROM chunks WHERE (embedding IS NULL OR embedding_model != ?) AND file_id IN (SELECT id FROM indexed_files)` = 0 **and** total > 0

### `EmbeddingStats`

```typescript
{ embedded: number, total: number, percent: number, isReady: boolean, hasProvider: boolean }
```

- `hasProvider` = `Boolean(this.embedder)` in `EmbeddingLoop`
- `getStats()` is on `EmbeddingLoop`, **not** on `RetrievalService`

### IPC

- New channel: `EMBEDDING_PROGRESS` — main → renderer push
- New handler: `EMBEDDING_STATS` — renderer requests, main responds with `EmbeddingStats`
- Restart loop on `STORE_SET` when key = `'ai'`

### `retrievalMode` in `AIConfig`

Inlined as a string union — **do NOT import from retrieval-contract** to avoid cross-module coupling:

```typescript
retrievalMode?: 'keyword' | 'vector' | 'hybrid' | 'auto'
```

---

## New Files to Create

| File                                                  | Purpose                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/shared/contracts/embedding-provider-contract.ts` | `EmbeddingProvider`, `RerankerProvider`, `RerankResult`, `EmbeddingStats` interfaces |
| `src/main/vectorUtils.ts`                             | `cosineSimilarity`, `normalizeVector`, `serializeEmbedding`, `deserializeEmbedding`  |
| `src/main/voyageEmbeddingProvider.ts`                 | Voyage AI SDK wrapper                                                                |
| `src/main/cohereEmbeddingProvider.ts`                 | Cohere SDK wrapper (embed + rerank)                                                  |
| `src/main/embeddingProviderFactory.ts`                | `createProviders(config)` → `{ embedder, reranker }`                                 |
| `src/main/embeddingLoop.ts`                           | Background embedding loop                                                            |
| `tests/main/vectorUtils.test.ts`                      | Unit tests for vector math                                                           |
| `tests/main/voyageEmbeddingProvider.test.ts`          | Unit tests with mocked SDK                                                           |
| `tests/main/cohereEmbeddingProvider.test.ts`          | Unit tests with mocked SDK                                                           |
| `tests/main/embeddingProviderFactory.test.ts`         | Unit tests for provider selection logic                                              |
| `tests/main/embeddingLoop.test.ts`                    | Unit tests with fake timer + mock DB                                                 |

## Files to Modify

| File                                                                  | Change                                                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/shared/contracts/retrieval-contract.ts`                          | Add `'auto'` to `RetrievalMode`                                                                                   |
| `src/shared/ai-config.ts`                                             | Add `useReranking`, `retrievalMode` to `AIConfig` + defaults                                                      |
| `src/shared/ipc-types.ts`                                             | Add `EmbeddingProgressPayload`, `EMBEDDING_PROGRESS`/`EMBEDDING_STATS` channels, `KordaAPI` extensions            |
| `src/main/fileIndexService.ts`                                        | Schema migration: `ALTER TABLE chunks ADD COLUMN embedding_model TEXT`                                            |
| `src/main/retrievalService.ts`                                        | `searchVector`, `mergeWithRRF`, `applyRerank`, `embedQuery`; `search()` mode routing; `isVectorReady()` real impl |
| `src/main/toolRegistry.ts`                                            | Pass `mode: 'auto'` to `retrievalService.search()`                                                                |
| `src/main/main.ts`                                                    | Init embedding loop, register IPC handlers, restart on settings change                                            |
| `src/preload/preload.ts`                                              | Bridge `onEmbeddingProgress` + `getEmbeddingStats`                                                                |
| `src/renderer/modules/settings/pages/AI.tsx`                          | `useReranking` checkbox, `retrievalMode` radio group                                                              |
| `src/renderer/modules/knowledge/components/KnowledgeStatusBanner.tsx` | Progress/no-provider/complete banner states                                                                       |
| `src/renderer/modules/knowledge/KnowledgeModule.tsx`                  | Subscribe to embedding progress, pass stats to banner                                                             |

---

## Test Commands

```bash
# Run all tests
npm test

# Run specific test file
npx vitest run tests/main/embeddingLoop.test.ts

# Type-check
npx tsc --noEmit

# Build
npm run build
```

All tests must pass. No TypeScript errors. No skipped tests.

---

## Definition of Done

- [ ] `npm test` passes (all existing + new tests green)
- [ ] `npx tsc --noEmit` exits clean
- [ ] `EmbeddingLoop` processes unembedded chunks in the background (manual smoke test: add a file to knowledge base, observe `EMBEDDING_PROGRESS` events in devtools)
- [ ] AI Settings page shows `useReranking` checkbox and `retrievalMode` radio group
- [ ] `KnowledgeStatusBanner` shows embedding progress when active, "no provider" hint when no key, nothing when complete
- [ ] `search()` with `mode: 'auto'` falls back to keyword when not ready, switches to hybrid when ready
- [ ] All new code follows existing patterns (look at `src/main/ingestionQueue.ts` as a model for background loop patterns, `src/main/retrievalService.ts` for the search layer)

---

## Important Warnings

1. **`voyageai` named export only** — `import { VoyageAIClient } from 'voyageai'`, never `import Voyage from 'voyageai'`
2. **`EmbeddingStats` lives in `embedding-provider-contract.ts`** — do NOT import it from `ipc-types`
3. **`EmbeddingLoop.init()` must call `destroy()` first** — it is called on every settings change, must be idempotent
4. **Mock `.results.at(-1)!` not `.results[0]`** in Vitest `beforeEach` — a new instance is created each test
5. **Cohere `embed` response cast** — `(response as { embeddings: { float?: number[][] } }).embeddings.float ?? []` — the type is a union, `float` is optional
6. **Schema migration in try/catch** — column may already exist on re-run: `try { db.exec('ALTER TABLE chunks ADD COLUMN embedding_model TEXT') } catch {}`
7. **`getEmbeddingStats()` is NOT on `RetrievalService`** — IPC handler calls `embeddingLoop.getStats()` directly
