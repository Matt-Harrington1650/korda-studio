# KORDA Studio Phase 3A — RAG Foundation Design Spec

**Date:** 2026-03-22
**Status:** Ready for implementation
**Scope:** Architecture contracts · Ingestion pipeline · Retrieval service · Knowledge Search UI

---

## 1. Context and Goals

### Current state

KORDA Studio has three layers that are entirely decoupled:

- **Chat UI / session layer** — `chatService.ts`, conversations and messages in SQLite
- **LLM provider layer** — `llmClient.ts`, Anthropic API streaming, no tool use
- **File indexing layer** — `fileIndexService.ts`, filename-parsed metadata in SQLite, no text extraction

No text is extracted from files. No chunks exist. Chat has no access to indexed content. RAG is not possible in the current architecture.

### What Phase 3A delivers

A complete RAG foundation — self-contained and useful on its own — without yet wiring retrieval into chat (that is Phase 3B):

1. **Locked contracts** between all layers (TypeScript interfaces in `src/shared/contracts/`)
2. **Ingestion pipeline** — text extraction from PDF/Word/Excel/text files in worker threads, hybrid chunking, FTS5 indexing, optional contextual enrichment via Claude
3. **Retrieval service** — FTS5/BM25 keyword search over chunks, with vector search and hybrid retrieval ready to activate when embeddings are added
4. **Knowledge Search module** — non-generative retrieval UI, chunk preview panel, ingestion status observability

### What Phase 3A explicitly defers

- Grounded chat with citations (Phase 3B)
- Claude tool use wiring into chat (Phase 3B)
- Voyage AI embeddings and vector search population (Phase 3C)
- Cohere reranking beyond configuration (Phase 3B/3C)
- CAD/BIM file extraction (DWG, DXF, IFC, RVT) — deferred to a future phase using Autodesk Platform Services
- Evaluation harness (Phase 3C)

---

## 2. Architecture Overview

```
Filesystem (network shares, local, mapped drives)
    │
    ▼
fileIndexService.crawlSource()
    │  registers files → pipeline_state = 'new'
    ▼
ingestionQueue.ts
    │  batches 'new' → 'queued', dispatches to workers
    ▼
ingestionWorker.ts (worker_threads, 2 concurrent)
    │  extract → chunk → [contextualize] → FTS5 index → set 'indexed'
    ▼
chunks table (INTEGER file_id FK) + chunks_fts (FTS5, rowid-aligned)
    │
    ▼
retrievalService.ts
    │  keyword (BM25) | vector (cosine) | hybrid (RRF) | rerank (Cohere, optional)
    ▼
KnowledgeModule (renderer)          chatService (Phase 3B, via tool use)
    non-generative search UI             grounded answers with citations
```

---

## 3. Schema Changes

### 3.1 `files` table — 4 new columns (additive migration, idempotent)

```sql
ALTER TABLE files ADD COLUMN pipeline_state TEXT NOT NULL DEFAULT 'new';
ALTER TABLE files ADD COLUMN pipeline_error TEXT;
ALTER TABLE files ADD COLUMN pipeline_updated_at INTEGER;
ALTER TABLE files ADD COLUMN page_count INTEGER;
```

**Pipeline state values:**

| State             | Meaning                                                         |
| ----------------- | --------------------------------------------------------------- |
| `new`             | Registered by crawler, not yet queued for extraction            |
| `queued`          | In the worker queue                                             |
| `extracting`      | Worker is reading and extracting text                           |
| `chunking`        | Worker is splitting text into chunks                            |
| `contextualizing` | Claude is generating context prefixes (only if enabled)         |
| `indexed`         | Chunks written to DB and FTS5, ready for retrieval              |
| `failed`          | Extraction or chunking failed; `pipeline_error` contains reason |
| `skipped`         | Unsupported file type or empty file; not an error               |

Files with `pipeline_state = 'skipped'` include all CAD/BIM formats (`.dwg`, `.dxf`, `.rvt`, `.ifc`, `.nwd`, `.rfa`) and binary formats without extractors. They remain searchable by filename/metadata via the existing Projects module.

### 3.2 `chunks` table (new)

**Important:** The existing `files` table uses `id INTEGER PRIMARY KEY AUTOINCREMENT`. `chunks.file_id` must match this type as `INTEGER` to satisfy the foreign key and avoid casting bugs at the TypeScript boundary. `chunks.id` uses a TEXT UUID since chunk IDs are generated in worker threads where auto-increment is not safe across concurrent connections.

`chunks` must remain a standard rowid table (NOT `WITHOUT ROWID`) so that FTS5 triggers can use `new.rowid` / `old.rowid` to maintain the content table sync. Do not add `WITHOUT ROWID` to this table in any future migration.

```sql
CREATE TABLE IF NOT EXISTS chunks (
  id             TEXT PRIMARY KEY,           -- UUID (worker-generated)
  file_id        INTEGER NOT NULL            -- matches files.id INTEGER PK
                   REFERENCES files(id) ON DELETE CASCADE,
  source_id      TEXT NOT NULL,
  chunk_index    INTEGER NOT NULL,           -- 0-based position within document
  text           TEXT NOT NULL,              -- chunk content (with context prefix if enriched)
  token_count    INTEGER NOT NULL,           -- approximated as ceil(char_count / 4)
  char_count     INTEGER NOT NULL,
  page_number    INTEGER,                    -- PDFs: 1-based page number
  section_title  TEXT,                       -- Word docs: nearest heading above chunk
  sheet_name     TEXT,                       -- Excel: sheet name
  embedding      BLOB,                       -- NULL until Phase 3C (Voyage AI)
                                             -- Format when populated: IEEE 754 float32
                                             -- little-endian byte array (4 bytes/dim)
  created_at     INTEGER NOT NULL,
  UNIQUE(file_id, chunk_index)
  -- Standard rowid table — required for FTS5 content table sync via triggers
);

CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_chunks_source_id ON chunks(source_id);
```

### 3.3 `chunks_fts` virtual table (FTS5)

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text,
  section_title,
  content='chunks',
  content_rowid='rowid',
  tokenize='porter unicode61'
);
```

Porter stemmer handles engineering term variations: `fire/fired/fire-rated`, `struct/structural`, `spec/specification`, `reinforce/reinforced/reinforcement`.

FTS5 content table approach: the virtual table reads from `chunks` — no text duplication. Triggers maintain sync:

```sql
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text, section_title)
  VALUES (new.rowid, new.text, new.section_title);
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
```

### 3.4 `chunks_vec` virtual table — deferred to Phase 3C

`sqlite-vec` requires a native shared library loaded via `db.loadExtension()` in better-sqlite3 — it does not have a usable WASM build for this context. Adding it requires `electron-rebuild` and an ABI-matched binary, which is non-trivial. Since Phase 3A does not populate any embeddings, creating the virtual table now adds risk with no benefit.

**Decision:** Do not create `chunks_vec` in Phase 3A. The `embedding BLOB NULL` column on the `chunks` table is the Phase 3C readiness hook. Phase 3C will add sqlite-vec (or an alternative embedded vector store) as part of the embeddings implementation.

Phase 3C will specify the exact `CREATE VIRTUAL TABLE` DDL, the `INSERT INTO chunks_vec(rowid, embedding)` write path, and the vector search query once the integration approach is confirmed.

---

## 4. TypeScript Contracts (`src/shared/contracts/`)

### 4.1 `llm-provider.ts`

Formalizes what `llmClient.ts` already does and adds the tool use path needed by Phase 3B.

```typescript
export interface LLMMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LLMFinalMessage {
  inputTokens: number
  outputTokens: number
}

export interface LLMStreamResult {
  iterable: AsyncIterable<string>
  abort(): void
  finalMessage(): Promise<LLMFinalMessage>
}

import type { AgentTool } from './agent-tool-contract'

export interface LLMToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface LLMProvider {
  /** Plain streaming — current chat mode */
  stream(messages: LLMMessage[], model: string, systemPrompt: string): LLMStreamResult

  /** Streaming with tool use — Phase 3B grounded chat.
   *  Throws NotImplementedError in Phase 3A; implemented in Phase 3B. */
  streamWithTools(
    messages: LLMMessage[],
    tools: AgentTool[],
    model: string,
    systemPrompt: string,
  ): LLMStreamResult & {
    onToolCall(cb: (call: LLMToolCall) => Promise<unknown>): void
  }
}
```

`AgentTool` imported from `agent-tool-contract.ts` — no circular dependency since that file does not import from `llm-provider.ts`.

`testConnection()` intentionally excluded — it belongs to a settings/health check concern, not the provider contract. The existing `chatTestConnection` IPC handler in `main.ts` remains as-is.

**Migration note:** `llmClient.ts` currently defines `LLMClient`, `LLMMessage`, `LLMFinalMessage`, and `LLMStreamResult` locally. In Phase 3A, `llmClient.ts` deletes these local definitions and imports from `src/shared/contracts/llm-provider.ts`. `AnthropicClient` gains `implements LLMProvider`. `chatService.ts` (the only consumer) updates its import path from `./llmClient` to `../shared/contracts/llm-provider` for the interface types.

### 4.2 `index-record.ts`

```typescript
export type PipelineState =
  | 'new'
  | 'queued'
  | 'extracting'
  | 'chunking'
  | 'contextualizing'
  | 'indexed'
  | 'failed'
  | 'skipped'

export interface IndexRecord {
  fileId: number // INTEGER — matches files.id INTEGER PRIMARY KEY AUTOINCREMENT
  path: string
  name: string
  sourceId: string
  contentHash: string | null
  pipelineState: PipelineState
  pipelineError: string | null
  pipelineUpdatedAt: number | null
  pageCount: number | null
}
```

### 4.3 `chunk-record.ts`

```typescript
export interface ChunkRecord {
  id: string // UUID
  fileId: number // INTEGER — matches files.id INTEGER PRIMARY KEY
  sourceId: string
  chunkIndex: number
  text: string
  tokenCount: number
  charCount: number
  pageNumber: number | null // PDFs
  sectionTitle: string | null // Word docs
  sheetName: string | null // Excel
  embedding: Buffer | null // NULL until Phase 3C
  // When populated: IEEE 754 float32 little-endian
  // byte array (4 bytes per dimension)
  createdAt: number
}
```

### 4.4 `retrieval-contract.ts`

```typescript
import type { ChunkRecord } from './chunk-record'
import type { FileEntry } from '../ipc-types'

export type RetrievalMode = 'keyword' | 'vector' | 'hybrid'

export interface RetrievalParams {
  query: string
  sourceId?: string
  project?: string
  limit?: number // default: 10
  mode?: RetrievalMode // default: 'keyword' until embeddings populated
}

export interface RetrievalResult {
  chunk: ChunkRecord
  file: FileEntry
  bm25Score: number | null // FTS5 rank (negative — lower is better)
  vectorDistance: number | null // cosine distance (Phase 3C)
  rrfScore: number | null // hybrid merged score (Phase 3C)
  highlight: string // FTS5 snippet() with <mark> tags
}

export interface RetrievalProvider {
  search(params: RetrievalParams): Promise<RetrievalResult[]>
  isVectorReady(): boolean // true when any chunk has a non-null embedding
}
```

### 4.5 `citation-contract.ts`

Locked now for Phase 3B. Not implemented in Phase 3A.

```typescript
export interface Citation {
  citationIndex: number // [1], [2], etc. — matches markers in answer text
  fileId: number
  chunkId: string
  filePath: string
  fileName: string
  pageNumber: number | null
  sectionTitle: string | null
  excerpt: string // the chunk text used in the answer
  sourceId: string
}

export type EvidenceStatus = 'supported' | 'partial' | 'unsupported'

export interface GroundedAnswer {
  text: string // answer text with [N] citation markers inline
  citations: Citation[]
  evidenceStatus: EvidenceStatus
  retrievedChunkCount: number
  searchQueriesUsed: string[] // Claude may search multiple times via tool use
}
```

### 4.6 `agent-tool-contract.ts`

```typescript
export interface AgentTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description?: string }>
    required?: string[]
  }
  execute(input: Record<string, unknown>): Promise<AgentToolResult>
}

export interface AgentToolResult {
  content: unknown
  isError?: boolean
}

/**
 * The search_knowledge_base tool — primary tool for grounded chat (Phase 3B).
 * Defined here as the canonical shape; wired in retrievalService.ts.
 */
export const SEARCH_KNOWLEDGE_BASE_TOOL_NAME = 'search_knowledge_base' as const
```

---

## 5. Ingestion Pipeline

### 5.1 Architecture

Two `worker_threads.Worker` instances share the SQLite database via WAL mode (already enabled). The queue is SQLite-backed — durable across app restarts. No in-memory queue.

```
Main process                              Worker threads (×2)
─────────────────────────────────────     ──────────────────────────────
ingestionQueue.ts                         ingestionWorker.ts
  - polls for 'queued' files              - receives { fileId, filePath,
  - sends to idle worker                    sourceId, ext, contentHash }
  - receives progress updates             - runs extraction pipeline
  - emits IPC ingestion:progress          - writes chunks to SQLite
  - exposes ingestion:status IPC          - sends progress back to main
```

### 5.2 `ingestionQueue.ts`

```typescript
// Responsibilities:
// 1. On init: start 2 Worker instances
// 2. drainNew(): batch-update 'new' → 'queued' (up to 50 at a time), runs every 5s
// 3. dispatch(): send next 'queued' file to an idle worker
// 4. onWorkerProgress(): receive state updates, emit IPC to renderer
// 5. Expose retry(sourceId?): requeue all 'failed' files for source
```

Worker concurrency: 2 (configurable via AI settings in a future pass). Each worker signals `{ type: 'ready' }` when idle; queue sends next file immediately.

### 5.3 `ingestionWorker.ts`

Pipeline steps executed synchronously within the worker (no sub-threads):

```
1. SET pipeline_state = 'extracting', pipeline_updated_at = now
2. read extractor by ext:
   .txt .md       → textExtractor
   .pdf           → pdfExtractor        (returns { text, pageTexts[], pageCount })
   .docx          → docxExtractor       (returns { markdown, headingMap })
   .xlsx .xls .csv → xlsxExtractor      (returns { sheets: { name, text }[] })
   other          → SET pipeline_state = 'skipped'; return
3. SET pipeline_state = 'chunking'
4. chunker.chunk(extractedContent, ext) → ChunkRecord[]
5. If contextual enrichment enabled AND anthropic key present:
   SET pipeline_state = 'contextualizing'
   for each chunk: prepend Claude-generated context prefix (batched, max 10 concurrent)
6. INSERT chunks (batch), triggers populate chunks_fts automatically
7. SET pipeline_state = 'indexed', pipeline_updated_at = now
8. send { type: 'progress', fileId, state: 'indexed', chunkCount } to main
```

On any uncaught error:

```
SET pipeline_state = 'failed', pipeline_error = error.message, pipeline_updated_at = now
send { type: 'progress', fileId, state: 'failed', error: message }
```

Failed files are never retried automatically. User initiates retry via the Connections page or `ingestion:retry` IPC call.

### 5.4 Extractors (`src/main/extractors/`)

**`text-extractor.ts`**

```typescript
// Handles: .txt, .md
// Returns: { text: string }
// Implementation: fs.readFile with utf-8 encoding, throws on binary detection
// Note: .csv is handled by xlsx-extractor (row-group chunking), not here
```

**`pdf-extractor.ts`**

```typescript
// Handles: .pdf
// Library: pdf-parse
// Returns: { text: string, pageTexts: string[], pageCount: number }
// Notes:
//   - pageTexts[i] contains text for page i+1 (1-based)
//   - If text is empty (scanned PDF), returns { text: '', pageCount }
//     with pipeline_state staying 'indexed' (zero chunks, file is searchable by name)
//   - Does NOT invoke OCR in Phase 3A — scanned PDFs produce 0 chunks
```

**`docx-extractor.ts`**

```typescript
// Handles: .docx
// Library: mammoth (convertToMarkdown)
// Returns: { markdown: string, headingMap: Map<number, string> }
//   headingMap: character offset → heading text
//   Used by chunker to attach section_title to chunks
// Notes:
//   - mammoth preserves heading hierarchy as # / ## / ###
//   - Tables converted to markdown pipe format
//   - Images ignored (alt text only)
```

**`xlsx-extractor.ts`**

```typescript
// Handles: .xlsx, .xls, .csv
// Library: xlsx
// Returns: { sheets: Array<{ name: string, text: string }> }
//   Each sheet's rows are tab-separated, newline-delimited
//   sheet.text is the full stringified content of that sheet
// Notes:
//   - Formula results used, not formulas themselves
//   - Empty sheets skipped
//   - Sheet name passed to chunker for sheet_name metadata
```

### 5.5 `chunker.ts` — Hybrid strategy

**Target chunk size:** 512 tokens (≈2,048 chars). Token count approximated as `Math.ceil(charCount / 4)` — fast, no tokenizer dependency, adequate for indexing purposes.

**Overlap:** 10% — last ~200 chars of chunk N are prepended to chunk N+1. Prevents context loss at boundaries.

**Minimum chunk size:** 100 chars. Fragments below this are merged with the adjacent chunk.

**Per-format strategy:**

| Format         | Primary boundary                   | Subdivision                             | Metadata attached                 |
| -------------- | ---------------------------------- | --------------------------------------- | --------------------------------- |
| `.txt` / `.md` | Paragraph (`\n\n`)                 | Fixed-size with overlap if > 512 tokens | None                              |
| `.pdf`         | Page boundary                      | Fixed-size with overlap within page     | `page_number`                     |
| `.docx`        | Heading sections (from headingMap) | Fixed-size with overlap within section  | `section_title` (nearest heading) |
| `.xlsx`        | Sheet boundary                     | Row groups (50 rows per chunk)          | `sheet_name`                      |
| `.csv`         | Row groups (50 rows per chunk)     | None                                    | `sheet_name = 'Sheet1'`           |

**Output:** `ChunkRecord[]` with all metadata fields populated. IDs are UUIDs generated in the worker.

### 5.6 Contextual Enrichment (optional)

When enabled in AI Settings (`contextualEnrichment: boolean`), after chunking the worker calls Claude to generate a context prefix for each chunk:

**Prompt per chunk:**

```
You are indexing an engineering document for retrieval. Given the document metadata and a text excerpt, write ONE sentence of context that will help someone retrieve this excerpt later. Be specific: include document type, project name, section topic, and any key identifiers.

Document: {fileName}
Project: {project}
Source: {sourceName}
{sectionTitle ? `Section: ${sectionTitle}` : ''}
{pageNumber ? `Page: ${pageNumber}` : ''}

Excerpt:
{chunkText}

Context sentence:
```

The response is prepended to the chunk text: `"[Context: {response}]\n\n{originalText}"`. This significantly improves FTS5 and vector retrieval quality because isolated chunk text ("the corridor assembly shall...") gains document context ("This excerpt is from the Fire Protection Spec for Project X, Section 4.2, covering passive fire resistance of Level 2-4 corridors...").

**Cost estimate shown in UI:** Shown as cost-per-1,000-chunks (approximately $0.04 per 1,000 chunks at current Haiku pricing, ~$0.40 at Sonnet pricing). Total chunk count is known from `IngestionStatus.totalChunks` after initial indexing runs; before that, the UI shows the per-1,000 rate only. This avoids displaying an unknowable total before any files are indexed.

**Batching:** 10 concurrent Claude calls per worker to stay within rate limits.

---

## 6. Retrieval Service (`src/main/retrievalService.ts`)

Implements `RetrievalProvider`. Three modes progressively activated based on available capabilities.

### 6.1 Mode 1 — Keyword (FTS5/BM25, active from Phase 3A day one)

```sql
SELECT
  c.id, c.file_id, c.chunk_index, c.text, c.token_count, c.char_count,
  c.page_number, c.section_title, c.sheet_name, c.created_at,
  f.path, f.name, f.ext, f.size_bytes, f.modified_ms,
  f.project, f.discipline, f.doc_type, f.source_id, f.drawing_number,
  f.revision, f.issue_status,
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
LIMIT ?
```

FTS5 `rank` is negative (lower = more relevant). `snippet()` returns a 32-word excerpt with `<mark>` tags around matched terms.

### 6.2 Mode 2 — Vector (deferred to Phase 3C)

Vector search requires sqlite-vec (native binary) and populated embeddings (Voyage AI). Both are deferred to Phase 3C. The `embedding BLOB NULL` column on `chunks` and the `isVectorReady()` method on `RetrievalProvider` are the readiness hooks. Phase 3A `retrievalService` always returns `isVectorReady() = false` and ignores `mode: 'vector'` or `mode: 'hybrid'` by falling back to keyword.

Phase 3C will specify the exact sqlite-vec integration, the Voyage AI embedding call, and the vector query DDL including the correct rowid correspondence between `chunks` and the vector virtual table.

### 6.3 Mode 3 — Hybrid with RRF (deferred to Phase 3C)

Hybrid retrieval (BM25 + vector via Reciprocal Rank Fusion) activates in Phase 3C alongside vector search. Documented here for contract completeness:

```typescript
// RRF formula (applied in Phase 3C):
rrfScore = 1 / (60 + keywordRank) + 1 / (60 + vectorRank)
// k=60 is the standard constant — reduces sensitivity to absolute rank position
```

Results sorted descending by `rrfScore`. Top 20 passed to reranker if Cohere key configured.

### 6.4 Reranking (optional — Cohere Rerank 3.5)

If a Cohere API key is present in AI settings:

```typescript
// POST https://api.cohere.com/v1/rerank
{
  model: 'rerank-v3.5',
  query: params.query,
  documents: top20Results.map(r => r.chunk.text),
  top_n: params.limit ?? 10
}
```

Returns relevance scores. Results reordered by Cohere relevance score. Adds ~300ms but meaningfully improves precision for engineering queries where BM25 may surface drawing numbers while a spec section is actually more relevant.

Degrades gracefully — if no key, or if Cohere call fails, returns pre-rerank results without error.

### 6.5 `search_knowledge_base` tool definition

```typescript
export const searchKnowledgeBaseTool: AgentTool = {
  name: SEARCH_KNOWLEDGE_BASE_TOOL_NAME,
  description: `Search indexed engineering documents for relevant information.
Use specific terms: spec section numbers, drawing numbers, project codes,
material specs (e.g. "ASTM A706"), discipline codes, or conceptual queries.
Call multiple times with different queries to build complete context.`,
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      project: { type: 'string', description: 'Filter to a specific project folder name' },
      source_id: { type: 'string', description: 'Filter to a specific file source ID' },
      limit: { type: 'number', description: 'Max results (default 8, max 20)' },
    },
    required: ['query'],
  },
  execute: async (input) => {
    const results = await retrievalService.search({
      query: input.query as string,
      project: input.project as string | undefined,
      sourceId: input.source_id as string | undefined,
      limit: Math.min((input.limit as number | undefined) ?? 8, 20),
    })
    return { content: results }
  },
}
```

This tool is registered in Phase 3B when `streamWithTools` is wired in `chatService`. In Phase 3A it exists as a named export from `retrievalService.ts` but is not yet called from chat.

### 6.6 New IPC channels

| Channel              | Direction       | Payload                                  | Returns                                                    |
| -------------------- | --------------- | ---------------------------------------- | ---------------------------------------------------------- |
| `knowledge:search`   | renderer → main | `RetrievalParams`                        | `RetrievalResult[]`                                        |
| `knowledge:adjacent` | renderer → main | `{ fileId: number, chunkIndex: number }` | `{ prev: ChunkRecord \| null, next: ChunkRecord \| null }` |
| `ingestion:status`   | renderer → main | `{ sourceId?: string }`                  | `IngestionStatus`                                          |
| `ingestion:retry`    | renderer → main | `{ sourceId?: string }`                  | `void`                                                     |
| `ingestion:progress` | main → renderer | `IngestionProgressEvent`                 | —                                                          |

`knowledge:adjacent` powers the "← Prev chunk / Next chunk →" navigation in `ChunkPreview` without adding `fileId`/`chunkIndex` filter fields to `RetrievalParams` (which is a search contract, not a navigation contract). Implemented as a simple `SELECT … WHERE file_id = ? AND chunk_index = ?` query in `retrievalService`.

**Initialization order:** `retrievalService` must be initialized after `fileIndexService.init()` completes — it queries `pipeline_state` which is added by the migration that runs inside `fileIndexService.init()`. In `main.ts`, initialize in sequence: `fileIndexService.init()` → `ingestionQueue.init()` → `retrievalService.init()`.

```typescript
// New types in ipc-types.ts:

interface IngestionStatus {
  new: number
  queued: number
  extracting: number
  chunking: number
  contextualizing: number
  indexed: number
  failed: number
  skipped: number
  total: number
  totalChunks: number
  avgChunksPerFile: number
}

interface IngestionProgressEvent {
  fileId: number
  state: PipelineState
  chunkCount?: number
  error?: string
}
```

---

## 7. Knowledge Search Module (`src/renderer/modules/knowledge/`)

### 7.1 Module structure

```
knowledge/
  index.ts                        — module registration (name, icon, Component)
  KnowledgeModule.tsx             — layout, state, search orchestration
  KnowledgeModule.test.tsx
  components/
    KnowledgeResults.tsx          — result card list
    KnowledgeResults.test.tsx
    ChunkPreview.tsx              — side panel: full chunk, metadata, navigation
    ChunkPreview.test.tsx
    KnowledgeStatusBanner.tsx     — ingestion progress bar / warning
    KnowledgeStatusBanner.test.tsx
```

Registered in `moduleRegistry.ts` between Projects and Chat in the sidebar.

### 7.2 `KnowledgeModule.tsx` — state and behavior

```typescript
// State:
const [query, setQuery] = useState('')
const [results, setResults] = useState<RetrievalResult[]>([])
const [selected, setSelected] = useState<RetrievalResult | null>(null)
const [loading, setLoading] = useState(false)
const [sourceId, setSourceId] = useState<string | undefined>()
const [project, setProject] = useState<string | undefined>()
const [ingestionStatus, setIngestionStatus] = useState<IngestionStatus | null>(null)

// Search: triggered on Enter or 300ms debounce
// Calls: window.kordaAPI.knowledgeSearch({ query, sourceId, project, limit: 20 })

// Ingestion status: polled every 10s via ingestion:status IPC
// Also updated in real-time via onIngestionProgress listener
```

**Layout:** Search bar full-width at top. Filter row below (source scope + project dropdowns, reuses Phase 2E components). Results list left 60% / chunk preview right 40% (slides in on selection, closeable). Status banner above search bar when files are queued or failed.

### 7.3 Result cards (`KnowledgeResults.tsx`)

Each card:

```
┌──────────────────────────────────────────────────────────────┐
│ 📄 Fire Protection Specification — Section 4.2  [Project X]  │
│    page 14 · Passive Fire Resistance Requirements             │
│                                                               │
│    ...corridor assemblies shall achieve a minimum             │
│    <mark>fire rating</mark> of 2 hours per IBC 1020.1...      │
│                                                       [Open]  │
└──────────────────────────────────────────────────────────────┘
```

- File icon based on extension
- Source badge if multiple sources active
- `page_number`, `section_title`, or `sheet_name` shown as secondary line
- Highlight uses `dangerouslySetInnerHTML` with `<mark>` sanitized to only that tag
- `[Open]` calls `window.kordaAPI.fileIndexOpen(result.file.path)`
- Click card body → opens ChunkPreview panel

### 7.4 `ChunkPreview.tsx` — side panel

```
┌─────────────────────────────────────────┐
│ Fire Protection Specification           │
│ Section 4.2 · Page 14 · Project X       │
│ Engineering Shares · Modified 2026-01-15│
├─────────────────────────────────────────┤
│ [← Prev chunk]           [Next chunk →] │
├─────────────────────────────────────────┤
│                                         │
│  [Context: This excerpt is from the...] │  ← context prefix if enriched
│                                         │
│  ...the full chunk text with query      │
│  terms <mark>highlighted</mark>...      │
│                                         │
├─────────────────────────────────────────┤
│  [Open File]        [Copy Excerpt]      │
└─────────────────────────────────────────┘
```

Adjacent chunk navigation calls `knowledge:adjacent` with `{ fileId, chunkIndex ± 1 }` — user can read surrounding context without opening the file. This uses the dedicated adjacent IPC channel, not the search path.

`Copy Excerpt` copies: `"{chunk text}" — {fileName}, {sectionTitle ?? pageNumber ?? ''}, {project}`

### 7.5 `KnowledgeStatusBanner.tsx`

Shown when `ingestionStatus.queued + ingestionStatus.extracting + ingestionStatus.chunking > 0` or `ingestionStatus.failed > 0`:

```
[●] Indexing 847 files · 3 failed  [Retry Failed]  [×]
```

Progress bar showing `indexed / total`. Dismissible for the session.

### 7.6 Empty states

| Condition                          | Message                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| No query yet                       | `"Search your indexed engineering documents"` with example queries            |
| No results                         | `"No results for '[query]'. Try broader terms or check Connections."`         |
| No files indexed yet               | `"No documents indexed yet. Add a file source in Settings → Connections."`    |
| Files registered but not extracted | `"Files are registered but not yet extracted. Check ingestion status below."` |

---

## 8. Settings Changes

### 8.1 AI Settings page — new fields

**Voyage AI section:**

```
Voyage AI API Key   [••••••••••••]  [Test]
                    ✓ Semantic search enabled (voyage-3)
                    Embeddings will be generated during next reindex.
```

**Cohere section:**

```
Cohere API Key      [••••••••••••]  [Test]
                    ✓ Reranking enabled (rerank-v3.5)
```

**Contextual Enrichment:**

```
Contextual Retrieval   [Toggle ON/OFF]
  Uses Claude to generate a context sentence for each chunk during ingestion.
  Improves retrieval quality. Estimated cost: ~$0.04 per 1,000 chunks.
  ⚠ Requires re-indexing all files after enabling.
```

All three API keys stored in electron-store under the `ai` key. Added to `AIConfig` type in `ai-config.ts`.

### 8.2 Connections page — ingestion status per source

Each source row gains a status pill:

```
[●] Engineering Shares   network-share   ✓ 1,204 indexed  3 failed  12 queued
```

Failed count is a link that expands an inline list of failed filenames + error reasons. Per-source `[Retry Failed]` button.

### 8.3 System Status — Knowledge Base panel

```
Knowledge Base
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Files indexed          1,201
Chunks indexed        24,819
Avg chunks/file           20
Files failed               3    [View Failed]
Files skipped             47    (unsupported format)
Search mode           Keyword   (add Voyage AI key for semantic)
Contextual enrichment    OFF    (enable in AI Settings)
Reranking                OFF    (add Cohere key in AI Settings)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 9. Dependencies

| Package                 | Purpose                          | Native rebuild? | When used                         |
| ----------------------- | -------------------------------- | --------------- | --------------------------------- |
| `pdf-parse`             | PDF text extraction              | No — pure JS    | Ingestion worker                  |
| `mammoth`               | `.docx` → markdown               | No — pure JS    | Ingestion worker                  |
| `xlsx`                  | `.xlsx`/`.xls`/`.csv` extraction | No — pure JS    | Ingestion worker                  |
| `@cohere-ai/cohere-sdk` | Optional reranking               | No — pure JS    | retrievalService (if key present) |

Voyage AI is called via `fetch` to OpenAI-compatible endpoint — no package needed.

No new native modules. No additional `electron-rebuild` complications.

---

## 10. Complete File Map

### Create

```
src/shared/contracts/
  llm-provider.ts
  index-record.ts
  chunk-record.ts
  retrieval-contract.ts
  citation-contract.ts          (Phase 3B implementation, shape locked now)
  agent-tool-contract.ts

src/main/extractors/
  text-extractor.ts
  text-extractor.test.ts
  pdf-extractor.ts
  pdf-extractor.test.ts
  docx-extractor.ts
  docx-extractor.test.ts
  xlsx-extractor.ts
  xlsx-extractor.test.ts

src/main/
  chunker.ts
  chunker.test.ts
  ingestionWorker.ts            (worker_threads Worker — pipeline steps not callable as functions)
  ingestionWorker.integration.test.ts  (spawns real Worker against temp SQLite DB)
  ingestionQueue.ts
  ingestionQueue.test.ts
  retrievalService.ts
  retrievalService.test.ts

src/renderer/modules/knowledge/
  index.ts
  KnowledgeModule.tsx
  KnowledgeModule.test.tsx
  components/
    KnowledgeResults.tsx
    KnowledgeResults.test.tsx
    ChunkPreview.tsx
    ChunkPreview.test.tsx
    KnowledgeStatusBanner.tsx
    KnowledgeStatusBanner.test.tsx
```

### Modify

```
src/main/fileIndexService.ts
  — additive schema migration (pipeline_state, pipeline_error, pipeline_updated_at, page_count)
  — chunks table + FTS5 triggers created on init (chunks_vec deferred to Phase 3C)
  — crawlSource() sets pipeline_state = 'new' for newly discovered files
  — deleteSourceData() extends to DELETE FROM chunks WHERE source_id = ?

src/main/llmClient.ts
  — add implements LLMProvider
  — add streamWithTools() signature (implemented in Phase 3B, throws NotImplementedError for now)

src/main/main.ts
  — knowledge:search handler → retrievalService.search()
  — ingestion:status handler → ingestionQueue.getStatus()
  — ingestion:retry handler → ingestionQueue.retry(sourceId?)
  — ingestion:progress IPC push registration

src/preload/preload.ts
  — knowledgeSearch bridge
  — knowledgeAdjacent bridge
  — ingestionStatus bridge
  — ingestionRetry bridge
  — onIngestionProgress listener bridge

src/shared/ipc-types.ts
  — KordaAPI: knowledgeSearch, knowledgeAdjacent, ingestionStatus, ingestionRetry, onIngestionProgress
  — IPC_CHANNELS: KNOWLEDGE_SEARCH, KNOWLEDGE_ADJACENT, INGESTION_STATUS, INGESTION_RETRY, INGESTION_PROGRESS
  — New types: RetrievalResult, IngestionStatus, IngestionProgressEvent
  — AIConfig extended: voyageApiKey?, cohereApiKey?, contextualEnrichment?

src/shared/ai-config.ts
  — AIConfig extended with voyageApiKey, cohereApiKey, contextualEnrichment fields

src/renderer/moduleRegistry.ts + src/renderer/router.tsx
  — Knowledge module registered (between Projects and Chat)

src/renderer/modules/settings/pages/AI.tsx
  — Voyage AI key field, Cohere key field, contextual enrichment toggle

src/renderer/modules/settings/pages/Connections.tsx
  — Per-source ingestion status pill and failed file expansion

src/renderer/modules/system-status/SystemStatusModule.tsx
  — Knowledge Base panel
```

---

## 11. Phase Boundaries

| Phase              | Deliverable                                                                                                                                   | Depends on                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **3A** (this spec) | Contracts locked · ingestion pipeline (PDF/Word/Excel/text) · FTS5 keyword retrieval · Knowledge Search module (keyword only) · Observability | Nothing new                 |
| **3B**             | Grounded chat mode · Claude tool use (search_knowledge_base) · citation UX · Cohere reranking                                                 | 3A retrieval proven working |
| **3C**             | Voyage AI embeddings · sqlite-vec populated · hybrid retrieval (BM25 + vector + RRF) · evaluation harness                                     | 3A + 3B stable              |

Phase 3A is self-contained and delivers real user value independently: engineers can search their indexed documents by content — not just by filename — before any AI synthesis is added.

---

## 12. Testing Strategy

**TDD per module, per the project convention:**

- `text-extractor.test.ts` — fixture files (.txt, .md) → expected text output
- `pdf-extractor.test.ts` — fixture PDF with known pages → expected text + page count
- `docx-extractor.test.ts` — fixture .docx with headings → markdown + headingMap
- `xlsx-extractor.test.ts` — fixture .xlsx and .csv with multiple sheets/rows → sheet text
- `chunker.test.ts` — various input sizes and formats → expected chunk counts, boundaries, metadata
- `ingestionQueue.test.ts` — mock workers, verify state transitions in SQLite
- `retrievalService.test.ts` — in-memory SQLite with fixture chunks → search results, ranking
- `KnowledgeModule.test.tsx` — mock IPC, verify search/filter/preview interactions
- `KnowledgeResults.test.tsx` — render result cards with highlights
- `ChunkPreview.test.tsx` — render preview, adjacent navigation, copy action

`ingestionWorker.ts` pipeline steps cannot be called as functions from a test (worker_threads boundary — the worker runs in a separate context). Covered by `ingestionWorker.integration.test.ts` which spawns a real `Worker` instance against a temp SQLite DB and verifies end-to-end state transitions. Vitest supports `new Worker()` in Node.js test environment.

---

## 13. Open Questions (resolved before implementation)

All resolved during brainstorming:

| Question                 | Decision                                                                  |
| ------------------------ | ------------------------------------------------------------------------- |
| Extraction scope         | PDF + Word + Excel + text; CAD/BIM skipped (deferred to APS phase)        |
| Pipeline execution model | worker_threads, 2 concurrent workers                                      |
| Chunking strategy        | Hybrid C: fixed-size with structure-aware metadata (page, section, sheet) |
| Vector storage           | Deferred to Phase 3C — `embedding BLOB NULL` column is the readiness hook |
| Retrieval approach       | FTS5/BM25 now; vector + hybrid (RRF) in Phase 3C                          |
| Embedding provider       | Voyage AI voyage-3 (Anthropic partner, when Phase 3C activates)           |
| Reranking                | Cohere Rerank 3.5 (optional, key-gated)                                   |
| Grounded chat wiring     | Claude tool use via streamWithTools() — Phase 3B                          |
| Contextual retrieval     | Optional enrichment step during ingestion, user-controlled                |
| Phase decomposition      | 3 phases: 3A Foundation · 3B Grounded Chat · 3C Vector + Eval             |
