# Phase 3A — RAG Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete RAG foundation to KORDA Studio — ingestion pipeline, FTS5 retrieval, and Knowledge Search UI — without yet wiring retrieval into chat (Phase 3B).

**Architecture:** Six TypeScript contract files lock all inter-layer interfaces. A two-worker `worker_threads` ingestion pipeline extracts PDF/Word/Excel/text files into a SQLite `chunks` table with FTS5 triggers. A `retrievalService` exposes BM25 keyword search (vector search deferred to Phase 3C). A new `KnowledgeModule` in the renderer provides non-generative document search with chunk preview.

**Tech Stack:** Electron 41 · React 19 · TypeScript strict · better-sqlite3 · Vitest + jsdom · worker_threads · pdf-parse · mammoth · xlsx · @cohere-ai/cohere-sdk · Tailwind v4 · Zustand v5

**Spec:** `docs/superpowers/specs/2026-03-22-korda-studio-phase3a-rag-foundation-design.md` — read this before any task. All schema DDL, interface definitions, IPC channel shapes, and UI layouts are fully specified there.

**Test command:** `cd korda-studio && npx vitest run` (all tests) or `npx vitest run src/main/extractors/text-extractor.test.ts` (single file).

**Working directory for all commands:** `C:\code\Korda studio\korda-studio`

---

## Chunk 1: Dependencies + Contracts + Schema

### Task 1: Install dependencies

**Files:** `package.json`

- [ ] Run in `korda-studio/`:
  ```bash
  npm install pdf-parse mammoth xlsx @cohere-ai/cohere-sdk
  npm install --save-dev @types/pdf-parse @types/mammoth
  ```
- [ ] Verify no native rebuild warnings (all four packages are pure JS — no electron-rebuild needed).
- [ ] Commit:
  ```bash
  git add package.json package-lock.json
  git commit -m "feat(3a): install ingestion + retrieval dependencies"
  ```

---

### Task 2: TypeScript contracts

**Files — all CREATE in `src/shared/contracts/`:**

- `agent-tool-contract.ts`
- `llm-provider.ts`
- `index-record.ts`
- `chunk-record.ts`
- `retrieval-contract.ts`
- `citation-contract.ts`

No tests for pure type files. Create them in order (llm-provider imports agent-tool-contract).

- [ ] Create `src/shared/contracts/agent-tool-contract.ts`:

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

  export const SEARCH_KNOWLEDGE_BASE_TOOL_NAME = 'search_knowledge_base' as const
  ```

- [ ] Create `src/shared/contracts/llm-provider.ts`:

  ```typescript
  import type { AgentTool } from './agent-tool-contract'

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

- [ ] Create `src/shared/contracts/index-record.ts`:

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

- [ ] Create `src/shared/contracts/chunk-record.ts`:

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
    sheetName: string | null // Excel/CSV
    embedding: Buffer | null // NULL until Phase 3C
    createdAt: number
  }
  ```

- [ ] Create `src/shared/contracts/retrieval-contract.ts`:

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
    bm25Score: number | null
    vectorDistance: number | null // Phase 3C
    rrfScore: number | null // Phase 3C
    highlight: string // FTS5 snippet() with <mark> tags
  }

  export interface RetrievalProvider {
    search(params: RetrievalParams): Promise<RetrievalResult[]>
    isVectorReady(): boolean
  }
  ```

- [ ] Create `src/shared/contracts/citation-contract.ts`:

  ```typescript
  // Locked for Phase 3B. Not implemented in Phase 3A.
  export interface Citation {
    citationIndex: number
    fileId: number
    chunkId: string
    filePath: string
    fileName: string
    pageNumber: number | null
    sectionTitle: string | null
    excerpt: string
    sourceId: string
  }

  export type EvidenceStatus = 'supported' | 'partial' | 'unsupported'

  export interface GroundedAnswer {
    text: string
    citations: Citation[]
    evidenceStatus: EvidenceStatus
    retrievedChunkCount: number
    searchQueriesUsed: string[]
  }
  ```

- [ ] Run `npx tsc --noEmit` — must pass with zero errors.
- [ ] Commit:
  ```bash
  git add src/shared/contracts/
  git commit -m "feat(3a): add TypeScript contract interfaces"
  ```

---

### Task 3: Extend AIConfig and ipc-types

**Files — MODIFY:**

- `src/shared/ai-config.ts`
- `src/shared/ipc-types.ts`

- [ ] In `src/shared/ai-config.ts`, add three optional fields to `AIConfig` and `DEFAULT_AI_CONFIG`:

  ```typescript
  export interface AIConfig {
    provider: 'anthropic'
    anthropicApiKey: string
    defaultModel: string
    firmContext: string
    voyageApiKey?: string // Phase 3C: Voyage AI embeddings
    cohereApiKey?: string // Phase 3B/3C: Cohere reranking
    contextualEnrichment?: boolean // optional Claude context prefix per chunk
  }

  // In DEFAULT_AI_CONFIG add:
  //   voyageApiKey: '',
  //   cohereApiKey: '',
  //   contextualEnrichment: false,
  ```

- [ ] In `src/shared/ipc-types.ts`, add:

  **New type imports at top:**

  ```typescript
  import type { PipelineState } from './contracts/index-record'
  import type { ChunkRecord } from './contracts/chunk-record'
  import type { RetrievalParams, RetrievalResult } from './contracts/retrieval-contract'
  ```

  **New types (add after existing types):**

  ```typescript
  export interface IngestionStatus {
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

  export interface IngestionProgressEvent {
    fileId: number
    state: PipelineState
    chunkCount?: number
    error?: string
  }
  ```

  **Re-export contracts for renderer use:**

  ```typescript
  export type { RetrievalParams, RetrievalResult } from './contracts/retrieval-contract'
  export type { ChunkRecord } from './contracts/chunk-record'
  export type { PipelineState } from './contracts/index-record'
  ```

  **Add to `KordaAPI` interface:**

  ```typescript
  knowledgeSearch: (params: RetrievalParams) => Promise<RetrievalResult[]>
  knowledgeAdjacent: (fileId: number, chunkIndex: number) => Promise<{ prev: ChunkRecord | null; next: ChunkRecord | null }>
  ingestionStatus: (sourceId?: string) => Promise<IngestionStatus>
  ingestionRetry: (sourceId?: string) => Promise<void>
  onIngestionProgress: (cb: (event: IngestionProgressEvent) => void) => () => void
  ```

  **Add to `IPC_CHANNELS`:**

  ```typescript
  KNOWLEDGE_SEARCH: 'knowledge:search',
  KNOWLEDGE_ADJACENT: 'knowledge:adjacent',
  INGESTION_STATUS: 'ingestion:status',
  INGESTION_RETRY: 'ingestion:retry',
  INGESTION_PROGRESS: 'ingestion:progress',
  ```

- [ ] Run `npx tsc --noEmit` — zero errors.
- [ ] Commit:
  ```bash
  git add src/shared/ai-config.ts src/shared/ipc-types.ts
  git commit -m "feat(3a): extend AIConfig and ipc-types with ingestion/retrieval channels"
  ```

---

### Task 4: Schema migration in fileIndexService

**File — MODIFY:** `src/main/fileIndexService.ts`

Read this file fully before editing. The existing `init()` method runs schema migrations using `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE` patterns. Add the Phase 3A migrations to the same `init()` block.

- [ ] In `fileIndexService.ts` `init()`, after existing schema setup, add:

  ```typescript
  // Phase 3A: pipeline state columns on files (idempotent — ALTER TABLE ignores existing columns via try/catch)
  for (const col of [
    `ALTER TABLE files ADD COLUMN pipeline_state TEXT NOT NULL DEFAULT 'new'`,
    `ALTER TABLE files ADD COLUMN pipeline_error TEXT`,
    `ALTER TABLE files ADD COLUMN pipeline_updated_at INTEGER`,
    `ALTER TABLE files ADD COLUMN page_count INTEGER`,
  ]) {
    try {
      db.exec(col)
    } catch {
      /* column already exists */
    }
  }

  // chunks table — standard rowid table required for FTS5 content table sync
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id             TEXT PRIMARY KEY,
      file_id        INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      source_id      TEXT NOT NULL,
      chunk_index    INTEGER NOT NULL,
      text           TEXT NOT NULL,
      token_count    INTEGER NOT NULL,
      char_count     INTEGER NOT NULL,
      page_number    INTEGER,
      section_title  TEXT,
      sheet_name     TEXT,
      embedding      BLOB,
      created_at     INTEGER NOT NULL,
      UNIQUE(file_id, chunk_index)
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_file_id ON chunks(file_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_source_id ON chunks(source_id)`)

  // FTS5 virtual table — content table (no text duplication)
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      text,
      section_title,
      content='chunks',
      content_rowid='rowid',
      tokenize='porter unicode61'
    )
  `)

  // Sync triggers
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, text, section_title)
      VALUES (new.rowid, new.text, new.section_title);
    END
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text, section_title)
      VALUES ('delete', old.rowid, old.text, old.section_title);
    END
  `)
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text, section_title)
      VALUES ('delete', old.rowid, old.text, old.section_title);
      INSERT INTO chunks_fts(rowid, text, section_title)
      VALUES (new.rowid, new.text, new.section_title);
    END
  `)
  ```

- [ ] In `crawlSource()`, when inserting a newly discovered file, set `pipeline_state = 'new'`. When a file is already known but has changed (size/mtime), reset `pipeline_state = 'new'` so it gets re-ingested.

- [ ] In `deleteSourceData()`, add: `db.prepare('DELETE FROM chunks WHERE source_id = ?').run(sourceId)`

- [ ] Run `npx vitest run src/main/fileIndexService.test.ts` if it exists, else run `npx tsc --noEmit`.
- [ ] Commit:
  ```bash
  git add src/main/fileIndexService.ts
  git commit -m "feat(3a): schema migration — chunks table, FTS5 triggers, pipeline_state columns"
  ```

---

## Chunk 2: Extractors

### Task 5: text-extractor (TDD)

**Files — CREATE:**

- `src/main/extractors/text-extractor.ts`
- `src/main/extractors/text-extractor.test.ts`

- [ ] Write the failing test first (`text-extractor.test.ts`):

  ```typescript
  import { describe, it, expect } from 'vitest'
  import path from 'path'
  import fs from 'fs'
  import os from 'os'
  import { extractText } from './text-extractor'

  describe('text-extractor', () => {
    it('extracts content from a .txt file', async () => {
      const tmp = path.join(os.tmpdir(), 'test.txt')
      fs.writeFileSync(tmp, 'Hello extraction world')
      const result = await extractText(tmp)
      expect(result.text).toBe('Hello extraction world')
      fs.unlinkSync(tmp)
    })

    it('extracts content from a .md file', async () => {
      const tmp = path.join(os.tmpdir(), 'test.md')
      fs.writeFileSync(tmp, '# Heading\n\nSome text')
      const result = await extractText(tmp)
      expect(result.text).toContain('Heading')
      fs.unlinkSync(tmp)
    })

    it('throws if file cannot be read as UTF-8 text', async () => {
      const tmp = path.join(os.tmpdir(), 'test.bin')
      fs.writeFileSync(tmp, Buffer.from([0x00, 0xff, 0xfe, 0x00]))
      await expect(extractText(tmp)).rejects.toThrow()
      fs.unlinkSync(tmp)
    })
  })
  ```

- [ ] Run: `npx vitest run src/main/extractors/text-extractor.test.ts`
      Expected: FAIL — "Cannot find module './text-extractor'"

- [ ] Create `src/main/extractors/text-extractor.ts`:

  ```typescript
  import fs from 'fs/promises'

  export interface TextExtractResult {
    text: string
  }

  export async function extractText(filePath: string): Promise<TextExtractResult> {
    const text = await fs.readFile(filePath, 'utf-8')
    // Reject files that decoded as replacement characters (binary content)
    if (text.includes('\uFFFD')) {
      throw new Error(`File appears to be binary, not text: ${filePath}`)
    }
    return { text }
  }
  ```

- [ ] Run: `npx vitest run src/main/extractors/text-extractor.test.ts`
      Expected: PASS (3 tests)

- [ ] Commit:
  ```bash
  git add src/main/extractors/
  git commit -m "feat(3a): text-extractor with TDD"
  ```

---

### Task 6: pdf-extractor (TDD)

**Files — CREATE:**

- `src/main/extractors/pdf-extractor.ts`
- `src/main/extractors/pdf-extractor.test.ts`

- [ ] Write the failing test:

  ```typescript
  import { describe, it, expect, vi } from 'vitest'
  import { extractPdf } from './pdf-extractor'

  vi.mock('pdf-parse', () => ({
    default: vi.fn().mockResolvedValue({
      text: 'Full document text',
      numpages: 3,
      // pdf-parse doesn't split pages natively; we approximate
    }),
  }))

  describe('pdf-extractor', () => {
    it('returns text and page count', async () => {
      const result = await extractPdf('/fake/file.pdf')
      expect(result.text).toBe('Full document text')
      expect(result.pageCount).toBe(3)
    })

    it('returns empty text for scanned PDF without throwing', async () => {
      const { default: pdfParse } = await import('pdf-parse')
      vi.mocked(pdfParse).mockResolvedValueOnce({ text: '', numpages: 5 } as any)
      const result = await extractPdf('/fake/scanned.pdf')
      expect(result.text).toBe('')
      expect(result.pageCount).toBe(5)
    })
  })
  ```

- [ ] Run: `npx vitest run src/main/extractors/pdf-extractor.test.ts`
      Expected: FAIL

- [ ] Create `src/main/extractors/pdf-extractor.ts`:

  ```typescript
  import fs from 'fs/promises'
  import pdfParse from 'pdf-parse'

  export interface PdfExtractResult {
    text: string
    pageTexts: string[] // approximate — pdf-parse does not split by page
    pageCount: number
  }

  export async function extractPdf(filePath: string): Promise<PdfExtractResult> {
    const buffer = await fs.readFile(filePath)
    const data = await pdfParse(buffer)
    // pdf-parse provides full text; per-page split is approximate using form-feed chars
    const pageTexts = data.text
      .split('\f')
      .map((p: string) => p.trim())
      .filter(Boolean)
    return {
      text: data.text,
      pageTexts,
      pageCount: data.numpages,
    }
  }
  ```

- [ ] Run: `npx vitest run src/main/extractors/pdf-extractor.test.ts`
      Expected: PASS

- [ ] Commit:
  ```bash
  git add src/main/extractors/pdf-extractor.ts src/main/extractors/pdf-extractor.test.ts
  git commit -m "feat(3a): pdf-extractor with TDD"
  ```

---

### Task 7: docx-extractor (TDD)

**Files — CREATE:**

- `src/main/extractors/docx-extractor.ts`
- `src/main/extractors/docx-extractor.test.ts`

- [ ] Write the failing test:

  ```typescript
  import { describe, it, expect, vi } from 'vitest'
  import { extractDocx } from './docx-extractor'

  vi.mock('mammoth', () => ({
    convertToMarkdown: vi.fn().mockResolvedValue({
      value: '# Introduction\n\nThis is the intro.\n\n## Methods\n\nThe methods section.',
      messages: [],
    }),
  }))

  describe('docx-extractor', () => {
    it('returns markdown and a heading map', async () => {
      const result = await extractDocx('/fake/file.docx')
      expect(result.markdown).toContain('# Introduction')
      expect(result.headingMap).toBeInstanceOf(Map)
    })

    it('headingMap keys are character offsets of heading lines', async () => {
      const result = await extractDocx('/fake/file.docx')
      const entries = [...result.headingMap.entries()]
      expect(entries.length).toBeGreaterThan(0)
      // First entry should map offset 0 to 'Introduction'
      expect(entries[0][1]).toBe('Introduction')
    })
  })
  ```

- [ ] Run: `npx vitest run src/main/extractors/docx-extractor.test.ts`
      Expected: FAIL

- [ ] Create `src/main/extractors/docx-extractor.ts`:

  ```typescript
  import mammoth from 'mammoth'

  export interface DocxExtractResult {
    markdown: string
    headingMap: Map<number, string> // charOffset → heading text
  }

  export async function extractDocx(filePath: string): Promise<DocxExtractResult> {
    const result = await mammoth.convertToMarkdown({ path: filePath })
    const markdown = result.value

    // Build heading map: find all '# ...' lines and record their char offset
    const headingMap = new Map<number, string>()
    const headingRe = /^#{1,6}\s+(.+)$/gm
    let match: RegExpExecArray | null
    while ((match = headingRe.exec(markdown)) !== null) {
      headingMap.set(match.index, match[1].trim())
    }

    return { markdown, headingMap }
  }
  ```

- [ ] Run: `npx vitest run src/main/extractors/docx-extractor.test.ts`
      Expected: PASS

- [ ] Commit:
  ```bash
  git add src/main/extractors/docx-extractor.ts src/main/extractors/docx-extractor.test.ts
  git commit -m "feat(3a): docx-extractor with TDD"
  ```

---

### Task 8: xlsx-extractor (TDD)

**Files — CREATE:**

- `src/main/extractors/xlsx-extractor.ts`
- `src/main/extractors/xlsx-extractor.test.ts`

- [ ] Write the failing test:

  ```typescript
  import { describe, it, expect, vi } from 'vitest'
  import { extractXlsx } from './xlsx-extractor'

  vi.mock('xlsx', () => ({
    readFile: vi.fn().mockReturnValue({
      SheetNames: ['Sheet1', 'Summary'],
      Sheets: {
        Sheet1: {},
        Summary: {},
      },
    }),
    utils: {
      sheet_to_csv: vi
        .fn()
        .mockReturnValueOnce('col1,col2\nval1,val2\nval3,val4')
        .mockReturnValueOnce('total,100'),
    },
  }))

  describe('xlsx-extractor', () => {
    it('returns one entry per sheet with name and text', () => {
      const result = extractXlsx('/fake/file.xlsx')
      expect(result.sheets).toHaveLength(2)
      expect(result.sheets[0].name).toBe('Sheet1')
      expect(result.sheets[0].text).toContain('val1')
    })

    it('skips empty sheets', () => {
      const { utils } = await import('xlsx')
      vi.mocked(utils.sheet_to_csv).mockReturnValueOnce('').mockReturnValueOnce('data,here')
      const result = extractXlsx('/fake/file.xlsx')
      expect(result.sheets).toHaveLength(1)
      expect(result.sheets[0].name).toBe('Summary')
    })
  })
  ```

- [ ] Run: `npx vitest run src/main/extractors/xlsx-extractor.test.ts`
      Expected: FAIL

- [ ] Create `src/main/extractors/xlsx-extractor.ts`:

  ```typescript
  import * as XLSX from 'xlsx'

  export interface XlsxExtractResult {
    sheets: Array<{ name: string; text: string }>
  }

  export function extractXlsx(filePath: string): XlsxExtractResult {
    const workbook = XLSX.readFile(filePath)
    const sheets: Array<{ name: string; text: string }> = []

    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name]
      // CSV format: rows tab-separated via csv output, newline-delimited
      const text = XLSX.utils.sheet_to_csv(sheet, { FS: '\t' }).trim()
      if (text.length === 0) continue
      sheets.push({ name, text })
    }

    return { sheets }
  }
  ```

  > Note: `.csv` files are also handled by this extractor — `XLSX.readFile` reads CSV natively. The sheet name will be the filename stem.

- [ ] Run: `npx vitest run src/main/extractors/xlsx-extractor.test.ts`
      Expected: PASS

- [ ] Commit:
  ```bash
  git add src/main/extractors/xlsx-extractor.ts src/main/extractors/xlsx-extractor.test.ts
  git commit -m "feat(3a): xlsx-extractor handles .xlsx/.xls/.csv with TDD"
  ```

---

## Chunk 3: Chunker + Retrieval Service

### Task 9: chunker (TDD)

**Files — CREATE:**

- `src/main/chunker.ts`
- `src/main/chunker.test.ts`

The chunker converts extractor output into `ChunkRecord[]`. Key constants from spec:

- Target: 512 tokens (≈ 2,048 chars), approximated as `Math.ceil(charCount / 4)`
- Overlap: 10% — last ~200 chars of chunk N prepended to chunk N+1
- Minimum: 100 chars — merge fragments below this with adjacent chunk
- IDs: UUID v4 (use `crypto.randomUUID()` — available in Node 19+/Electron 41)

- [ ] Write the failing test:

  ```typescript
  import { describe, it, expect } from 'vitest'
  import { chunk } from './chunker'

  describe('chunker', () => {
    it('produces a single chunk for short text', () => {
      const chunks = chunk({
        type: 'text',
        text: 'Hello world',
        fileId: 1,
        sourceId: 'src1',
      })
      expect(chunks).toHaveLength(1)
      expect(chunks[0].text).toBe('Hello world')
      expect(chunks[0].fileId).toBe(1)
      expect(chunks[0].chunkIndex).toBe(0)
      expect(typeof chunks[0].id).toBe('string')
    })

    it('splits long text into multiple chunks', () => {
      const longText = 'word '.repeat(1000) // ~5000 chars > 2048 target
      const chunks = chunk({ type: 'text', text: longText, fileId: 2, sourceId: 'src1' })
      expect(chunks.length).toBeGreaterThan(1)
    })

    it('assigns page_number to PDF chunks', () => {
      const chunks = chunk({
        type: 'pdf',
        pageTexts: ['Page one content', 'Page two content'],
        pageCount: 2,
        fileId: 3,
        sourceId: 'src1',
      })
      expect(chunks[0].pageNumber).toBe(1)
      expect(chunks[1].pageNumber).toBe(2)
    })

    it('assigns section_title to docx chunks', () => {
      const markdown = '# Introduction\n\nText here.\n\n## Methods\n\nMore text.'
      const headingMap = new Map([
        [0, 'Introduction'],
        [25, 'Methods'],
      ])
      const chunks = chunk({ type: 'docx', markdown, headingMap, fileId: 4, sourceId: 'src1' })
      expect(chunks[0].sectionTitle).toBe('Introduction')
    })

    it('assigns sheet_name to xlsx chunks', () => {
      const chunks = chunk({
        type: 'xlsx',
        sheets: [{ name: 'Budget', text: 'row1\nrow2\nrow3' }],
        fileId: 5,
        sourceId: 'src1',
      })
      expect(chunks[0].sheetName).toBe('Budget')
    })

    it('chunk indexes are 0-based and sequential', () => {
      const longText = 'x '.repeat(2000)
      const chunks = chunk({ type: 'text', text: longText, fileId: 6, sourceId: 'src1' })
      chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i))
    })

    it('tokenCount is ceil(charCount / 4)', () => {
      const chunks = chunk({ type: 'text', text: 'abcd', fileId: 7, sourceId: 'src1' })
      expect(chunks[0].charCount).toBe(4)
      expect(chunks[0].tokenCount).toBe(1)
    })
  })
  ```

- [ ] Run: `npx vitest run src/main/chunker.test.ts`
      Expected: FAIL

- [ ] Create `src/main/chunker.ts`:

  ```typescript
  import { randomUUID } from 'crypto'
  import type { ChunkRecord } from '../shared/contracts/chunk-record'

  const TARGET_CHARS = 2048 // ~512 tokens
  const OVERLAP_CHARS = 200
  const MIN_CHARS = 100

  type TextInput = { type: 'text'; text: string; fileId: number; sourceId: string }
  type PdfInput = {
    type: 'pdf'
    pageTexts: string[]
    pageCount: number
    fileId: number
    sourceId: string
  }
  type DocxInput = {
    type: 'docx'
    markdown: string
    headingMap: Map<number, string>
    fileId: number
    sourceId: string
  }
  type XlsxInput = {
    type: 'xlsx'
    sheets: Array<{ name: string; text: string }>
    fileId: number
    sourceId: string
  }

  export type ChunkInput = TextInput | PdfInput | DocxInput | XlsxInput

  export function chunk(input: ChunkInput): ChunkRecord[] {
    const now = Date.now()
    const records: ChunkRecord[] = []
    let index = 0

    function makeChunk(
      text: string,
      meta: { pageNumber?: number; sectionTitle?: string; sheetName?: string },
    ): ChunkRecord {
      const charCount = text.length
      return {
        id: randomUUID(),
        fileId: input.fileId,
        sourceId: input.sourceId,
        chunkIndex: index++,
        text,
        tokenCount: Math.ceil(charCount / 4),
        charCount,
        pageNumber: meta.pageNumber ?? null,
        sectionTitle: meta.sectionTitle ?? null,
        sheetName: meta.sheetName ?? null,
        embedding: null,
        createdAt: now,
      }
    }

    function splitText(
      text: string,
      meta: { pageNumber?: number; sectionTitle?: string; sheetName?: string },
    ): void {
      if (text.trim().length === 0) return
      if (text.length <= TARGET_CHARS) {
        records.push(makeChunk(text, meta))
        return
      }
      let start = 0
      while (start < text.length) {
        let end = start + TARGET_CHARS
        if (end < text.length) {
          // Try to break at paragraph boundary
          const paraBreak = text.lastIndexOf('\n\n', end)
          if (paraBreak > start + MIN_CHARS) end = paraBreak
        }
        const slice = text.slice(start, Math.min(end, text.length)).trim()
        if (slice.length >= MIN_CHARS) {
          records.push(makeChunk(slice, meta))
        } else if (records.length > 0) {
          // Merge short fragment into previous chunk
          const prev = records[records.length - 1]
          prev.text += ' ' + slice
          prev.charCount = prev.text.length
          prev.tokenCount = Math.ceil(prev.charCount / 4)
        }
        start = end - OVERLAP_CHARS
        if (start <= 0 || end >= text.length) break
      }
    }

    if (input.type === 'text') {
      splitText(input.text, {})
    } else if (input.type === 'pdf') {
      input.pageTexts.forEach((pageText, i) => {
        splitText(pageText, { pageNumber: i + 1 })
      })
    } else if (input.type === 'docx') {
      // Split at heading boundaries first
      const sections = splitAtHeadings(input.markdown, input.headingMap)
      for (const { text, heading } of sections) {
        splitText(text, { sectionTitle: heading })
      }
    } else if (input.type === 'xlsx') {
      for (const sheet of input.sheets) {
        // Row-group chunking: 50 rows per chunk
        const rows = sheet.text.split('\n')
        const GROUP = 50
        for (let i = 0; i < rows.length; i += GROUP) {
          const text = rows
            .slice(i, i + GROUP)
            .join('\n')
            .trim()
          if (text.length >= MIN_CHARS) {
            records.push(makeChunk(text, { sheetName: sheet.name }))
          }
        }
      }
    }

    return records
  }

  function splitAtHeadings(
    markdown: string,
    headingMap: Map<number, string>,
  ): Array<{ text: string; heading: string | undefined }> {
    if (headingMap.size === 0) return [{ text: markdown, heading: undefined }]
    const offsets = [...headingMap.keys()].sort((a, b) => a - b)
    const sections: Array<{ text: string; heading: string | undefined }> = []
    for (let i = 0; i < offsets.length; i++) {
      const start = offsets[i]
      const end = offsets[i + 1] ?? markdown.length
      sections.push({ text: markdown.slice(start, end).trim(), heading: headingMap.get(start) })
    }
    return sections
  }
  ```

- [ ] Run: `npx vitest run src/main/chunker.test.ts`
      Expected: PASS (7 tests)

- [ ] Commit:
  ```bash
  git add src/main/chunker.ts src/main/chunker.test.ts
  git commit -m "feat(3a): hybrid chunker with TDD"
  ```

---

### Task 10: retrievalService (TDD)

**Files — CREATE:**

- `src/main/retrievalService.ts`
- `src/main/retrievalService.test.ts`

The retrieval service runs BM25 keyword search via FTS5. In Phase 3A, `isVectorReady()` always returns `false` and `mode: 'vector'` / `mode: 'hybrid'` fall back to keyword.

- [ ] Write the failing test:

  ```typescript
  import { describe, it, expect, beforeEach, afterEach } from 'vitest'
  import Database from 'better-sqlite3'
  import { RetrievalService } from './retrievalService'

  // We need a real in-memory SQLite DB with the full schema
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
    return db
  }

  describe('RetrievalService', () => {
    let db: Database.Database
    let service: RetrievalService

    beforeEach(() => {
      db = buildTestDb()
      service = new RetrievalService(db)
      // Seed a file and chunk
      const fileId = db
        .prepare(
          `INSERT INTO files (path, name, ext, size_bytes, modified_ms, source_id, pipeline_state)
         VALUES (?, ?, ?, ?, ?, ?, 'indexed')`,
        )
        .run('/docs/spec.pdf', 'spec.pdf', '.pdf', 1000, Date.now(), 'src1')
        .lastInsertRowid as number
      db.prepare(
        `
        INSERT INTO chunks (id, file_id, source_id, chunk_index, text, token_count, char_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        'chunk-1',
        fileId,
        'src1',
        0,
        'fire rated corridor assembly requirements',
        10,
        40,
        Date.now(),
      )
    })

    afterEach(() => db.close())

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
      const kw = await service.search({ query: 'fire', mode: 'keyword' })
      const vec = await service.search({ query: 'fire', mode: 'vector' })
      const hyb = await service.search({ query: 'fire', mode: 'hybrid' })
      expect(vec).toEqual(kw)
      expect(hyb).toEqual(kw)
    })

    it('highlight contains <mark> tags', async () => {
      const results = await service.search({ query: 'fire' })
      expect(results[0].highlight).toContain('<mark>')
    })
  })
  ```

- [ ] Run: `npx vitest run src/main/retrievalService.test.ts`
      Expected: FAIL

- [ ] Create `src/main/retrievalService.ts`:

  ```typescript
  import type Database from 'better-sqlite3'
  import type {
    RetrievalParams,
    RetrievalResult,
    RetrievalProvider,
  } from '../shared/contracts/retrieval-contract'
  import type { ChunkRecord } from '../shared/contracts/chunk-record'
  import type { FileEntry } from '../shared/ipc-types'

  export class RetrievalService implements RetrievalProvider {
    constructor(private readonly db: Database.Database) {}

    isVectorReady(): boolean {
      return false // Phase 3C activates this
    }

    async search(params: RetrievalParams): Promise<RetrievalResult[]> {
      const { query, sourceId, project, limit = 10 } = params
      // Vector and hybrid fall back to keyword in Phase 3A
      return this.keywordSearch(query, sourceId, project, limit)
    }

    private keywordSearch(
      query: string,
      sourceId: string | undefined,
      project: string | undefined,
      limit: number,
    ): RetrievalResult[] {
      const rows = this.db
        .prepare<[string, string | null, string | null, string | null, number]>(
          `
        SELECT
          c.id, c.file_id, c.chunk_index, c.text, c.token_count, c.char_count,
          c.page_number, c.section_title, c.sheet_name, c.embedding, c.created_at,
          c.source_id as chunk_source_id,
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
      `,
        )
        .all(
          query,
          sourceId ?? null,
          sourceId ?? null,
          project ?? null,
          project ?? null,
          limit,
        ) as any[]

      return rows.map((row) => {
        const chunk: ChunkRecord = {
          id: row.id,
          fileId: row.file_id,
          sourceId: row.chunk_source_id,
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
        const file: FileEntry = {
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
        return {
          chunk,
          file,
          bm25Score: row.bm25_score,
          vectorDistance: null,
          rrfScore: null,
          highlight: row.highlight ?? '',
        }
      })
    }

    getAdjacentChunks(
      fileId: number,
      chunkIndex: number,
    ): { prev: ChunkRecord | null; next: ChunkRecord | null } {
      const get = (idx: number): ChunkRecord | null => {
        const row = this.db
          .prepare(`SELECT * FROM chunks WHERE file_id = ? AND chunk_index = ?`)
          .get(fileId, idx) as any
        if (!row) return null
        return {
          id: row.id,
          fileId: row.file_id,
          sourceId: row.source_id,
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
      return { prev: get(chunkIndex - 1), next: get(chunkIndex + 1) }
    }

    getStatus(sourceId?: string): object {
      const where = sourceId ? `AND source_id = '${sourceId}'` : ''
      const states = [
        'new',
        'queued',
        'extracting',
        'chunking',
        'contextualizing',
        'indexed',
        'failed',
        'skipped',
      ]
      const counts: Record<string, number> = {}
      for (const s of states) {
        const row = this.db
          .prepare(
            `SELECT COUNT(*) as n FROM files WHERE pipeline_state = ? ${sourceId ? `AND source_id = '${sourceId}'` : ''}`,
          )
          .get(s) as { n: number }
        counts[s] = row.n
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      const chunkRow = this.db
        .prepare(
          `SELECT COUNT(*) as n FROM chunks ${sourceId ? `WHERE source_id = '${sourceId}'` : ''}`,
        )
        .get() as { n: number }
      const totalChunks = chunkRow.n
      return {
        ...counts,
        total,
        totalChunks,
        avgChunksPerFile: counts['indexed'] > 0 ? Math.round(totalChunks / counts['indexed']) : 0,
      }
    }
  }

  // Singleton — initialized in main.ts after fileIndexService.init()
  let _service: RetrievalService | null = null

  export const retrievalService = {
    init(db: Database.Database): void {
      _service = new RetrievalService(db)
    },
    search(params: RetrievalParams): Promise<RetrievalResult[]> {
      if (!_service) throw new Error('retrievalService not initialized')
      return _service.search(params)
    },
    getAdjacentChunks(fileId: number, chunkIndex: number) {
      if (!_service) throw new Error('retrievalService not initialized')
      return _service.getAdjacentChunks(fileId, chunkIndex)
    },
    getStatus(sourceId?: string) {
      if (!_service) throw new Error('retrievalService not initialized')
      return _service.getStatus(sourceId)
    },
    isVectorReady(): boolean {
      return _service?.isVectorReady() ?? false
    },
  }
  ```

- [ ] Run: `npx vitest run src/main/retrievalService.test.ts`
      Expected: PASS (6 tests)

- [ ] Commit:
  ```bash
  git add src/main/retrievalService.ts src/main/retrievalService.test.ts
  git commit -m "feat(3a): retrievalService with FTS5/BM25 keyword search and TDD"
  ```

---

## Chunk 4: Ingestion Pipeline

### Task 11: ingestionWorker

**File — CREATE:** `src/main/ingestionWorker.ts`

This file runs as a `worker_threads.Worker`. It cannot be unit-tested as a function — covered by integration test in Task 13. Write it carefully.

- [ ] Create `src/main/ingestionWorker.ts`:

  ```typescript
  import { workerData, parentPort } from 'worker_threads'
  import Database from 'better-sqlite3'
  import path from 'path'
  import { extractText } from './extractors/text-extractor'
  import { extractPdf } from './extractors/pdf-extractor'
  import { extractDocx } from './extractors/docx-extractor'
  import { extractXlsx } from './extractors/xlsx-extractor'
  import { chunk } from './chunker'
  import type { ChunkRecord } from '../shared/contracts/chunk-record'

  const { dbPath } = workerData as { dbPath: string }
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')

  type WorkerMessage = {
    type: 'job'
    fileId: number
    filePath: string
    sourceId: string
    ext: string
  }

  function setState(fileId: number, state: string, extra?: { error?: string; pageCount?: number }) {
    db.prepare(
      `UPDATE files SET pipeline_state = ?, pipeline_error = ?, page_count = COALESCE(?, page_count), pipeline_updated_at = ? WHERE id = ?`,
    ).run(state, extra?.error ?? null, extra?.pageCount ?? null, Date.now(), fileId)
    parentPort!.postMessage({ type: 'progress', fileId, state, error: extra?.error })
  }

  function insertChunks(chunks: ChunkRecord[]): void {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO chunks
        (id, file_id, source_id, chunk_index, text, token_count, char_count,
         page_number, section_title, sheet_name, embedding, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const insertMany = db.transaction((rows: ChunkRecord[]) => {
      for (const c of rows) {
        stmt.run(
          c.id,
          c.fileId,
          c.sourceId,
          c.chunkIndex,
          c.text,
          c.tokenCount,
          c.charCount,
          c.pageNumber,
          c.sectionTitle,
          c.sheetName,
          c.embedding,
          c.createdAt,
        )
      }
    })
    insertMany(chunks)
  }

  async function processJob(fileId: number, filePath: string, sourceId: string, ext: string) {
    try {
      setState(fileId, 'extracting')
      let chunks: ChunkRecord[] = []

      if (ext === '.txt' || ext === '.md') {
        const result = await extractText(filePath)
        setState(fileId, 'chunking')
        chunks = chunk({ type: 'text', text: result.text, fileId, sourceId })
      } else if (ext === '.pdf') {
        const result = await extractPdf(filePath)
        setState(fileId, 'chunking')
        chunks = chunk({
          type: 'pdf',
          pageTexts: result.pageTexts,
          pageCount: result.pageCount,
          fileId,
          sourceId,
        })
        if (chunks.length === 0) {
          // Scanned PDF — zero chunks, mark indexed anyway
          setState(fileId, 'indexed', { pageCount: result.pageCount })
          parentPort!.postMessage({ type: 'progress', fileId, state: 'indexed', chunkCount: 0 })
          parentPort!.postMessage({ type: 'ready' })
          return
        }
      } else if (ext === '.docx') {
        const result = await extractDocx(filePath)
        setState(fileId, 'chunking')
        chunks = chunk({
          type: 'docx',
          markdown: result.markdown,
          headingMap: result.headingMap,
          fileId,
          sourceId,
        })
      } else if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
        const result = extractXlsx(filePath)
        setState(fileId, 'chunking')
        chunks = chunk({ type: 'xlsx', sheets: result.sheets, fileId, sourceId })
      } else {
        setState(fileId, 'skipped')
        parentPort!.postMessage({ type: 'ready' })
        return
      }

      if (chunks.length > 0) {
        insertChunks(chunks)
      }
      setState(fileId, 'indexed')
      parentPort!.postMessage({
        type: 'progress',
        fileId,
        state: 'indexed',
        chunkCount: chunks.length,
      })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      setState(fileId, 'failed', { error })
      parentPort!.postMessage({ type: 'progress', fileId, state: 'failed', error })
    }

    parentPort!.postMessage({ type: 'ready' })
  }

  parentPort!.on('message', (msg: WorkerMessage) => {
    if (msg.type === 'job') {
      processJob(msg.fileId, msg.filePath, msg.sourceId, msg.ext)
    }
  })

  // Signal ready on startup
  parentPort!.postMessage({ type: 'ready' })
  ```

- [ ] Run `npx tsc --noEmit` — zero errors.
- [ ] Commit:
  ```bash
  git add src/main/ingestionWorker.ts
  git commit -m "feat(3a): ingestionWorker — pipeline steps in worker_threads"
  ```

---

### Task 12: ingestionQueue (TDD)

**Files — CREATE:**

- `src/main/ingestionQueue.ts`
- `src/main/ingestionQueue.test.ts`

The queue polls SQLite every 5 seconds for `pipeline_state = 'new'`, batches up to 50 at a time to `queued`, then dispatches to idle workers. Workers signal `{ type: 'ready' }` when idle.

- [ ] Write the failing test:

  ```typescript
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
  import Database from 'better-sqlite3'
  import { IngestionQueue } from './ingestionQueue'

  // Mock worker_threads.Worker
  vi.mock('worker_threads', () => {
    const EventEmitter = require('events')
    class MockWorker extends EventEmitter {
      postMessage = vi.fn()
      terminate = vi.fn()
    }
    return { Worker: MockWorker }
  })

  function makeDb() {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL, name TEXT NOT NULL, ext TEXT DEFAULT '',
        size_bytes INTEGER DEFAULT 0, modified_ms INTEGER DEFAULT 0,
        source_id TEXT DEFAULT 'src1',
        pipeline_state TEXT NOT NULL DEFAULT 'new',
        pipeline_error TEXT, pipeline_updated_at INTEGER, page_count INTEGER
      )
    `)
    return db
  }

  describe('IngestionQueue', () => {
    let db: Database.Database
    let queue: IngestionQueue

    beforeEach(() => {
      db = makeDb()
      queue = new IngestionQueue(db, '/fake/db.db', () => {}, 2)
    })
    afterEach(() => {
      queue.stop()
      db.close()
    })

    it('drainNew moves new files to queued state', () => {
      db.prepare(`INSERT INTO files (path, name) VALUES (?, ?)`).run('/a/b.pdf', 'b.pdf')
      queue.drainNew()
      const row = db.prepare(`SELECT pipeline_state FROM files WHERE name = 'b.pdf'`).get() as any
      expect(row.pipeline_state).toBe('queued')
    })

    it('retry resets failed files to new', () => {
      db.prepare(`INSERT INTO files (path, name, pipeline_state) VALUES (?, ?, 'failed')`).run(
        '/x.pdf',
        'x.pdf',
      )
      queue.retry()
      const row = db.prepare(`SELECT pipeline_state FROM files WHERE name = 'x.pdf'`).get() as any
      expect(row.pipeline_state).toBe('new')
    })

    it('getStatus returns counts per pipeline state', () => {
      db.prepare(`INSERT INTO files (path, name, pipeline_state) VALUES (?, ?, 'indexed')`).run(
        '/a.pdf',
        'a.pdf',
      )
      db.prepare(`INSERT INTO files (path, name, pipeline_state) VALUES (?, ?, 'failed')`).run(
        '/b.pdf',
        'b.pdf',
      )
      const status = queue.getStatus()
      expect(status.indexed).toBe(1)
      expect(status.failed).toBe(1)
      expect(status.total).toBe(2)
    })
  })
  ```

- [ ] Run: `npx vitest run src/main/ingestionQueue.test.ts`
      Expected: FAIL

- [ ] Create `src/main/ingestionQueue.ts`:

  ```typescript
  import { Worker } from 'worker_threads'
  import path from 'path'
  import type Database from 'better-sqlite3'
  import type { IngestionStatus, IngestionProgressEvent } from '../shared/ipc-types'

  export class IngestionQueue {
    private workers: Worker[] = []
    private idleWorkers: Worker[] = []
    private drainTimer: ReturnType<typeof setInterval> | null = null

    constructor(
      private readonly db: Database.Database,
      private readonly dbPath: string,
      private readonly onProgress: (event: IngestionProgressEvent) => void,
      private readonly concurrency = 2,
    ) {}

    init(): void {
      for (let i = 0; i < this.concurrency; i++) {
        const worker = new Worker(path.join(__dirname, 'ingestionWorker.js'), {
          workerData: { dbPath: this.dbPath },
        })
        worker.on('message', (msg: any) => {
          if (msg.type === 'ready') {
            this.idleWorkers.push(worker)
            this.dispatchNext()
          } else if (msg.type === 'progress') {
            this.onProgress(msg as IngestionProgressEvent)
          }
        })
        worker.on('error', (err) => console.error('[ingestionQueue] worker error:', err))
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
          `UPDATE files SET pipeline_state = 'queued', pipeline_updated_at = ?
         WHERE pipeline_state = 'new' LIMIT 50`,
        )
        .run(Date.now())
    }

    private dispatchNext(): void {
      if (this.idleWorkers.length === 0) return
      const row = this.db
        .prepare(
          `SELECT id, path, ext, source_id FROM files WHERE pipeline_state = 'queued' LIMIT 1`,
        )
        .get() as { id: number; path: string; ext: string; source_id: string } | undefined
      if (!row) return

      this.db
        .prepare(
          `UPDATE files SET pipeline_state = 'extracting', pipeline_updated_at = ? WHERE id = ?`,
        )
        .run(Date.now(), row.id)

      const worker = this.idleWorkers.pop()!
      worker.postMessage({
        type: 'job',
        fileId: row.id,
        filePath: row.path,
        sourceId: row.source_id,
        ext: row.ext,
      })
    }

    retry(sourceId?: string): void {
      const where = sourceId ? `AND source_id = ?` : ''
      const args: unknown[] = sourceId ? [sourceId] : []
      this.db
        .prepare(
          `UPDATE files SET pipeline_state = 'new', pipeline_error = NULL WHERE pipeline_state = 'failed' ${where}`,
        )
        .run(...args)
      this.drainNew()
      this.dispatchNext()
    }

    getStatus(sourceId?: string): IngestionStatus {
      const where = sourceId ? `WHERE source_id = ?` : ''
      const args = sourceId ? [sourceId] : []
      const states = [
        'new',
        'queued',
        'extracting',
        'chunking',
        'contextualizing',
        'indexed',
        'failed',
        'skipped',
      ] as const
      const counts: Record<string, number> = {}
      for (const s of states) {
        const wh = sourceId
          ? `WHERE pipeline_state = ? AND source_id = ?`
          : `WHERE pipeline_state = ?`
        const a = sourceId ? [s, sourceId] : [s]
        const row = this.db.prepare(`SELECT COUNT(*) as n FROM files ${wh}`).get(...a) as {
          n: number
        }
        counts[s] = row.n
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      const chunkRow = this.db
        .prepare(`SELECT COUNT(*) as n FROM chunks ${where}`)
        .get(...args) as { n: number }
      const totalChunks = chunkRow.n
      return {
        ...counts,
        total,
        totalChunks,
        avgChunksPerFile: counts['indexed'] > 0 ? Math.round(totalChunks / counts['indexed']) : 0,
      } as IngestionStatus
    }

    stop(): void {
      if (this.drainTimer) clearInterval(this.drainTimer)
      for (const w of this.workers) w.terminate()
      this.workers = []
      this.idleWorkers = []
    }
  }

  // Singleton
  let _queue: IngestionQueue | null = null

  export const ingestionQueue = {
    init(
      db: Database.Database,
      dbPath: string,
      onProgress: (e: IngestionProgressEvent) => void,
    ): void {
      _queue = new IngestionQueue(db, dbPath, onProgress)
      _queue.init()
      _queue.drainNew()
    },
    retry(sourceId?: string): void {
      _queue?.retry(sourceId)
    },
    getStatus(sourceId?: string): IngestionStatus {
      if (!_queue) throw new Error('ingestionQueue not initialized')
      return _queue.getStatus(sourceId)
    },
    stop(): void {
      _queue?.stop()
    },
    drainNew(): void {
      _queue?.drainNew()
    },
  }
  ```

- [ ] Run: `npx vitest run src/main/ingestionQueue.test.ts`
      Expected: PASS (3 tests)

- [ ] Commit:
  ```bash
  git add src/main/ingestionQueue.ts src/main/ingestionQueue.test.ts
  git commit -m "feat(3a): ingestionQueue with worker dispatch and TDD"
  ```

---

### Task 13: ingestionWorker integration test

**File — CREATE:** `src/main/ingestionWorker.integration.test.ts`

This spawns a real `Worker` and verifies end-to-end state transitions in a temp SQLite DB. Vitest Node environment supports `new Worker()`.

- [ ] Create `src/main/ingestionWorker.integration.test.ts`:

  ```typescript
  import { describe, it, expect, beforeEach, afterEach } from 'vitest'
  import { Worker } from 'worker_threads'
  import Database from 'better-sqlite3'
  import path from 'path'
  import fs from 'fs'
  import os from 'os'

  const WORKER_PATH = path.resolve(__dirname, 'ingestionWorker.js')
  // Note: in test environment, TypeScript is compiled by Vitest — worker runs as .ts via tsx if available
  // If worker path doesn't exist, skip this test (run after build)

  function makeDb(dbPath: string) {
    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL, name TEXT NOT NULL, ext TEXT DEFAULT '',
        size_bytes INTEGER DEFAULT 0, modified_ms INTEGER DEFAULT 0,
        source_id TEXT DEFAULT 'src1',
        pipeline_state TEXT NOT NULL DEFAULT 'new',
        pipeline_error TEXT, pipeline_updated_at INTEGER, page_count INTEGER
      );
      CREATE TABLE chunks (
        id TEXT PRIMARY KEY, file_id INTEGER NOT NULL, source_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL, text TEXT NOT NULL, token_count INTEGER NOT NULL,
        char_count INTEGER NOT NULL, page_number INTEGER, section_title TEXT,
        sheet_name TEXT, embedding BLOB, created_at INTEGER NOT NULL,
        UNIQUE(file_id, chunk_index)
      );
      CREATE VIRTUAL TABLE chunks_fts USING fts5(
        text, section_title, content='chunks', content_rowid='rowid', tokenize='porter unicode61'
      );
      CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, text, section_title) VALUES (new.rowid, new.text, new.section_title);
      END;
    `)
    return db
  }

  describe.skipIf(!fs.existsSync(WORKER_PATH))('ingestionWorker integration', () => {
    let tmpDir: string
    let dbPath: string
    let db: Database.Database

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'korda-test-'))
      dbPath = path.join(tmpDir, 'test.db')
      db = makeDb(dbPath)
    })

    afterEach(() => {
      db.close()
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('indexes a .txt file end-to-end', async () => {
      const txtPath = path.join(tmpDir, 'sample.txt')
      fs.writeFileSync(txtPath, 'This is a sample engineering specification for testing retrieval.')
      const fileId = db
        .prepare(
          `INSERT INTO files (path, name, ext, size_bytes, modified_ms, pipeline_state)
         VALUES (?, 'sample.txt', '.txt', 100, ?, 'queued')`,
        )
        .run(txtPath, Date.now()).lastInsertRowid

      await new Promise<void>((resolve, reject) => {
        const worker = new Worker(WORKER_PATH, { workerData: { dbPath } })
        worker.on('message', (msg: any) => {
          if (msg.type === 'ready' && msg.fileId == null) {
            // Initial ready — send the job
            worker.postMessage({
              type: 'job',
              fileId,
              filePath: txtPath,
              sourceId: 'src1',
              ext: '.txt',
            })
          } else if (msg.type === 'progress' && msg.state === 'indexed') {
            worker.terminate()
            resolve()
          } else if (msg.type === 'progress' && msg.state === 'failed') {
            worker.terminate()
            reject(new Error(msg.error))
          }
        })
        worker.on('error', reject)
      })

      const file = db.prepare(`SELECT pipeline_state FROM files WHERE id = ?`).get(fileId) as any
      expect(file.pipeline_state).toBe('indexed')
      const chunks = db.prepare(`SELECT * FROM chunks WHERE file_id = ?`).all(fileId)
      expect(chunks.length).toBeGreaterThan(0)
    })
  })
  ```

- [ ] Run: `npx vitest run src/main/ingestionWorker.integration.test.ts`
      Expected: SKIP (worker .js not built yet) or PASS if vitest transpiles .ts workers.
- [ ] Commit:
  ```bash
  git add src/main/ingestionWorker.integration.test.ts
  git commit -m "feat(3a): ingestionWorker integration test"
  ```

---

## Chunk 5: IPC Wiring

### Task 14: Update llmClient to implement LLMProvider

**File — MODIFY:** `src/main/llmClient.ts`

- [ ] Read the current `src/main/llmClient.ts` fully before editing.
- [ ] Delete local definitions of `LLMMessage`, `LLMFinalMessage`, `LLMStreamResult`, `LLMClient` (all four interfaces — they now live in `src/shared/contracts/llm-provider.ts`).
- [ ] Add import:
  ```typescript
  import type {
    LLMProvider,
    LLMMessage,
    LLMFinalMessage,
    LLMStreamResult,
    LLMToolCall,
  } from '../shared/contracts/llm-provider'
  import type { AgentTool } from '../shared/contracts/agent-tool-contract'
  ```
- [ ] Change class declaration to: `export class AnthropicClient implements LLMProvider`
- [ ] Keep `stream()` exactly as it is — just the type source changes.
- [ ] Add `streamWithTools()` stub that throws (Phase 3B implements it):
  ```typescript
  streamWithTools(
    _messages: LLMMessage[],
    _tools: AgentTool[],
    _model: string,
    _systemPrompt: string
  ): ReturnType<LLMProvider['streamWithTools']> {
    throw new Error('streamWithTools not implemented until Phase 3B')
  }
  ```
- [ ] Update `chatService.ts` import: wherever it imports `LLMMessage`, `LLMStreamResult`, etc. from `./llmClient`, update to `'../shared/contracts/llm-provider'`.
- [ ] Run `npx tsc --noEmit` — zero errors.
- [ ] Commit:
  ```bash
  git add src/main/llmClient.ts src/main/chatService.ts
  git commit -m "feat(3a): llmClient implements LLMProvider contract"
  ```

---

### Task 15: main.ts — IPC handlers + init order

**File — MODIFY:** `src/main/main.ts`

- [ ] Read `src/main/main.ts` fully before editing.
- [ ] Add imports:

  ```typescript
  import { ingestionQueue } from './ingestionQueue'
  import { retrievalService } from './retrievalService'
  import type { RetrievalParams } from '../shared/contracts/retrieval-contract'
  ```

- [ ] In `app.whenReady()`, after `fileIndexService.init()`, add (in order):

  ```typescript
  // Initialization order matters: retrievalService queries pipeline_state columns
  // added by fileIndexService.init() schema migration
  const fileIndexDb = fileIndexService.getDb() // add getDb() to fileIndexService if not present
  retrievalService.init(fileIndexDb)
  ingestionQueue.init(fileIndexDb, path.join(app.getPath('userData'), 'file-index.db'), (event) => {
    mainWindow?.webContents.send(IPC_CHANNELS.INGESTION_PROGRESS, event)
  })
  ingestionQueue.drainNew()
  ```

- [ ] Add IPC handlers (after existing handlers):

  ```typescript
  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_SEARCH, (_event, params: RetrievalParams) => {
    return retrievalService.search(params)
  })

  ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_ADJACENT, (_event, fileId: number, chunkIndex: number) => {
    return retrievalService.getAdjacentChunks(fileId, chunkIndex)
  })

  ipcMain.handle(IPC_CHANNELS.INGESTION_STATUS, (_event, sourceId?: string) => {
    return ingestionQueue.getStatus(sourceId)
  })

  ipcMain.handle(IPC_CHANNELS.INGESTION_RETRY, (_event, sourceId?: string) => {
    ingestionQueue.retry(sourceId)
  })
  ```

- [ ] If `fileIndexService` does not expose `getDb()`, add it:
      In `fileIndexService.ts`: `getDb(): Database.Database { return db }`

- [ ] Run `npx tsc --noEmit` — zero errors.
- [ ] Commit:
  ```bash
  git add src/main/main.ts src/main/fileIndexService.ts
  git commit -m "feat(3a): main.ts — knowledge and ingestion IPC handlers"
  ```

---

### Task 16: preload.ts — IPC bridges

**File — MODIFY:** `src/preload/preload.ts`

- [ ] Read `src/preload/preload.ts` fully before editing. It uses `contextBridge.exposeInMainWorld('kordaAPI', { ... })`.
- [ ] Add bridges inside the exposed object:

  ```typescript
  knowledgeSearch: (params: RetrievalParams) =>
    ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_SEARCH, params),

  knowledgeAdjacent: (fileId: number, chunkIndex: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_ADJACENT, fileId, chunkIndex),

  ingestionStatus: (sourceId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.INGESTION_STATUS, sourceId),

  ingestionRetry: (sourceId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.INGESTION_RETRY, sourceId),

  onIngestionProgress: (cb: (event: IngestionProgressEvent) => void) => {
    const handler = (_: unknown, event: IngestionProgressEvent) => cb(event)
    ipcRenderer.on(IPC_CHANNELS.INGESTION_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.INGESTION_PROGRESS, handler)
  },
  ```

- [ ] Add necessary imports at top of preload.ts:
  ```typescript
  import type { RetrievalParams, IngestionProgressEvent } from '../shared/ipc-types'
  ```
- [ ] Run `npx tsc --noEmit` — zero errors.
- [ ] Commit:
  ```bash
  git add src/preload/preload.ts
  git commit -m "feat(3a): preload — knowledge and ingestion IPC bridges"
  ```

---

## Chunk 6: Knowledge Search UI

### Task 17: KnowledgeStatusBanner (TDD)

**Files — CREATE:**

- `src/renderer/modules/knowledge/components/KnowledgeStatusBanner.tsx`
- `src/renderer/modules/knowledge/components/KnowledgeStatusBanner.test.tsx`

- [ ] Write the failing test:

  ```typescript
  import { render, screen } from '@testing-library/react'
  import { KnowledgeStatusBanner } from './KnowledgeStatusBanner'
  import type { IngestionStatus } from '../../../../../shared/ipc-types'

  const idle: IngestionStatus = {
    new: 0, queued: 0, extracting: 0, chunking: 0, contextualizing: 0,
    indexed: 100, failed: 0, skipped: 5, total: 105, totalChunks: 2000, avgChunksPerFile: 20,
  }
  const active: IngestionStatus = { ...idle, queued: 10, extracting: 2, indexed: 50, total: 67 }
  const withFailed: IngestionStatus = { ...idle, failed: 3 }

  describe('KnowledgeStatusBanner', () => {
    it('renders nothing when idle with no failures', () => {
      const { container } = render(<KnowledgeStatusBanner status={idle} onRetry={() => {}} />)
      expect(container.firstChild).toBeNull()
    })

    it('shows indexing progress when files are in-flight', () => {
      render(<KnowledgeStatusBanner status={active} onRetry={() => {}} />)
      expect(screen.getByText(/Indexing/i)).toBeInTheDocument()
    })

    it('shows retry button when there are failures', () => {
      render(<KnowledgeStatusBanner status={withFailed} onRetry={() => {}} />)
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    })
  })
  ```

- [ ] Run: `npx vitest run src/renderer/modules/knowledge/components/KnowledgeStatusBanner.test.tsx`
      Expected: FAIL

- [ ] Create `src/renderer/modules/knowledge/components/KnowledgeStatusBanner.tsx`:

  ```typescript
  import type { IngestionStatus } from '../../../../../shared/ipc-types'

  interface Props {
    status: IngestionStatus | null
    onRetry: () => void
  }

  export function KnowledgeStatusBanner({ status, onRetry }: Props) {
    if (!status) return null
    const inFlight = status.queued + status.extracting + status.chunking + status.contextualizing
    const hasFailed = status.failed > 0
    if (inFlight === 0 && !hasFailed) return null

    const progress = status.total > 0 ? Math.round((status.indexed / status.total) * 100) : 0

    return (
      <div className="flex items-center gap-3 px-4 py-2 bg-surface-raised border-b border-border text-xs text-text-secondary">
        {inFlight > 0 && (
          <>
            <span className="text-accent animate-pulse">●</span>
            <span>Indexing {inFlight.toLocaleString()} files</span>
            <div className="flex-1 h-1 bg-surface rounded-full overflow-hidden max-w-32">
              <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>
          </>
        )}
        {hasFailed && (
          <span className="text-error ml-2">{status.failed} failed</span>
        )}
        {hasFailed && (
          <button onClick={onRetry} className="ml-auto underline hover:text-text-primary">
            Retry Failed
          </button>
        )}
      </div>
    )
  }
  ```

- [ ] Run: `npx vitest run src/renderer/modules/knowledge/components/KnowledgeStatusBanner.test.tsx`
      Expected: PASS

- [ ] Commit:
  ```bash
  git add src/renderer/modules/knowledge/components/KnowledgeStatusBanner.tsx \
          src/renderer/modules/knowledge/components/KnowledgeStatusBanner.test.tsx
  git commit -m "feat(3a): KnowledgeStatusBanner with TDD"
  ```

---

### Task 18: KnowledgeResults (TDD)

**Files — CREATE:**

- `src/renderer/modules/knowledge/components/KnowledgeResults.tsx`
- `src/renderer/modules/knowledge/components/KnowledgeResults.test.tsx`

The highlight field contains HTML with `<mark>` tags — rendered via `dangerouslySetInnerHTML`. Only allow `<mark>` — strip everything else.

- [ ] Write the failing test:

  ```typescript
  import { render, screen, fireEvent } from '@testing-library/react'
  import { KnowledgeResults } from './KnowledgeResults'
  import type { RetrievalResult } from '../../../../../shared/ipc-types'

  const makeResult = (id: string): RetrievalResult => ({
    chunk: {
      id, fileId: 1, sourceId: 'src1', chunkIndex: 0,
      text: 'fire rated corridor', tokenCount: 4, charCount: 19,
      pageNumber: 14, sectionTitle: 'Section 4.2', sheetName: null,
      embedding: null, createdAt: Date.now(),
    },
    file: {
      path: '/docs/spec.pdf', name: 'spec.pdf', ext: '.pdf',
      sizeBytes: 1000, modifiedMs: Date.now(), isDir: false,
      sourceId: 'src1', project: 'ProjectX', discipline: null,
      docType: null, drawingNumber: null, revision: null, issueStatus: null,
    },
    bm25Score: -1.5, vectorDistance: null, rrfScore: null,
    highlight: '…<mark>fire</mark> rated corridor…',
  })

  describe('KnowledgeResults', () => {
    it('renders a card for each result', () => {
      render(<KnowledgeResults results={[makeResult('a'), makeResult('b')]} onSelect={() => {}} />)
      expect(screen.getAllByRole('article')).toHaveLength(2)
    })

    it('shows filename and project', () => {
      render(<KnowledgeResults results={[makeResult('a')]} onSelect={() => {}} />)
      expect(screen.getByText('spec.pdf')).toBeInTheDocument()
      expect(screen.getByText('ProjectX')).toBeInTheDocument()
    })

    it('calls onSelect when card is clicked', () => {
      const onSelect = vi.fn()
      render(<KnowledgeResults results={[makeResult('a')]} onSelect={onSelect} />)
      fireEvent.click(screen.getByRole('article'))
      expect(onSelect).toHaveBeenCalledOnce()
    })

    it('renders empty state when no results', () => {
      render(<KnowledgeResults results={[]} onSelect={() => {}} query="fire" />)
      expect(screen.getByText(/no results/i)).toBeInTheDocument()
    })
  })
  ```

- [ ] Run: `npx vitest run src/renderer/modules/knowledge/components/KnowledgeResults.test.tsx`
      Expected: FAIL

- [ ] Create `src/renderer/modules/knowledge/components/KnowledgeResults.tsx`:

  ```typescript
  import type { RetrievalResult } from '../../../../../shared/ipc-types'

  interface Props {
    results: RetrievalResult[]
    onSelect: (result: RetrievalResult) => void
    query?: string
  }

  function sanitizeHighlight(html: string): string {
    // Only allow <mark> and </mark> — strip all other tags
    return html.replace(/<(?!\/?mark\b)[^>]+>/g, '')
  }

  const EXT_ICONS: Record<string, string> = {
    '.pdf': '📄', '.docx': '📝', '.xlsx': '📊', '.xls': '📊',
    '.csv': '📋', '.txt': '📃', '.md': '📃',
  }

  export function KnowledgeResults({ results, onSelect, query }: Props) {
    if (results.length === 0) {
      return (
        <div className="px-4 py-8 text-center text-text-secondary text-sm">
          {query
            ? `No results for "${query}". Try broader terms or check Connections.`
            : 'Search your indexed engineering documents'}
        </div>
      )
    }

    return (
      <div className="space-y-2 p-4">
        {results.map((r) => (
          <article
            key={r.chunk.id}
            role="article"
            onClick={() => onSelect(r)}
            className="border border-border rounded px-3 py-2 bg-surface-raised hover:border-accent cursor-pointer"
          >
            <div className="flex items-center gap-2 mb-1">
              <span>{EXT_ICONS[r.file.ext] ?? '📄'}</span>
              <span className="text-sm font-medium text-text-primary truncate">{r.file.name}</span>
              {r.file.project && (
                <span className="text-xs text-text-secondary ml-auto shrink-0">{r.file.project}</span>
              )}
            </div>
            {(r.chunk.sectionTitle || r.chunk.pageNumber || r.chunk.sheetName) && (
              <div className="text-xs text-text-secondary mb-1">
                {r.chunk.sectionTitle ?? r.chunk.sheetName ?? `Page ${r.chunk.pageNumber}`}
              </div>
            )}
            <div
              className="text-xs text-text-secondary line-clamp-2"
              dangerouslySetInnerHTML={{ __html: sanitizeHighlight(r.highlight || r.chunk.text.slice(0, 200)) }}
            />
          </article>
        ))}
      </div>
    )
  }
  ```

- [ ] Run: `npx vitest run src/renderer/modules/knowledge/components/KnowledgeResults.test.tsx`
      Expected: PASS

- [ ] Commit:
  ```bash
  git add src/renderer/modules/knowledge/components/KnowledgeResults.tsx \
          src/renderer/modules/knowledge/components/KnowledgeResults.test.tsx
  git commit -m "feat(3a): KnowledgeResults with highlight sanitization and TDD"
  ```

---

### Task 19: ChunkPreview (TDD)

**Files — CREATE:**

- `src/renderer/modules/knowledge/components/ChunkPreview.tsx`
- `src/renderer/modules/knowledge/components/ChunkPreview.test.tsx`

- [ ] Write the failing test:

  ```typescript
  import { render, screen, fireEvent } from '@testing-library/react'
  import { ChunkPreview } from './ChunkPreview'
  import type { RetrievalResult } from '../../../../../shared/ipc-types'

  const mockResult: RetrievalResult = {
    chunk: {
      id: 'c1', fileId: 1, sourceId: 'src1', chunkIndex: 2,
      text: 'corridor assemblies shall achieve a 2-hour fire rating',
      tokenCount: 10, charCount: 52,
      pageNumber: 14, sectionTitle: 'Section 4.2', sheetName: null,
      embedding: null, createdAt: Date.now(),
    },
    file: {
      path: '/docs/spec.pdf', name: 'spec.pdf', ext: '.pdf',
      sizeBytes: 1000, modifiedMs: Date.now(), isDir: false,
      sourceId: 'src1', project: 'ProjectX', discipline: null,
      docType: null, drawingNumber: null, revision: null, issueStatus: null,
    },
    bm25Score: -1.5, vectorDistance: null, rrfScore: null,
    highlight: '…<mark>fire</mark> rating…',
  }

  beforeEach(() => {
    Object.defineProperty(window, 'kordaAPI', {
      value: {
        fileIndexOpen: vi.fn().mockResolvedValue(''),
        knowledgeAdjacent: vi.fn().mockResolvedValue({ prev: null, next: null }),
      },
      writable: true,
    })
  })

  describe('ChunkPreview', () => {
    it('renders file name and section title', () => {
      render(<ChunkPreview result={mockResult} onClose={() => {}} />)
      expect(screen.getByText('spec.pdf')).toBeInTheDocument()
      expect(screen.getByText(/Section 4\.2/)).toBeInTheDocument()
    })

    it('renders chunk text', () => {
      render(<ChunkPreview result={mockResult} onClose={() => {}} />)
      expect(screen.getByText(/corridor assemblies/)).toBeInTheDocument()
    })

    it('calls onClose when close button clicked', () => {
      const onClose = vi.fn()
      render(<ChunkPreview result={mockResult} onClose={onClose} />)
      fireEvent.click(screen.getByLabelText('close preview'))
      expect(onClose).toHaveBeenCalled()
    })

    it('calls fileIndexOpen when Open File clicked', async () => {
      render(<ChunkPreview result={mockResult} onClose={() => {}} />)
      fireEvent.click(screen.getByText(/open file/i))
      expect(window.kordaAPI.fileIndexOpen).toHaveBeenCalledWith('/docs/spec.pdf')
    })
  })
  ```

- [ ] Run: `npx vitest run src/renderer/modules/knowledge/components/ChunkPreview.test.tsx`
      Expected: FAIL

- [ ] Create `src/renderer/modules/knowledge/components/ChunkPreview.tsx`:

  ```typescript
  import { useState, useEffect } from 'react'
  import type { RetrievalResult, ChunkRecord } from '../../../../../shared/ipc-types'

  interface Props {
    result: RetrievalResult
    onClose: () => void
  }

  export function ChunkPreview({ result, onClose }: Props) {
    const { chunk, file } = result
    const [prev, setPrev] = useState<ChunkRecord | null>(null)
    const [next, setNext] = useState<ChunkRecord | null>(null)

    useEffect(() => {
      window.kordaAPI.knowledgeAdjacent(chunk.fileId, chunk.chunkIndex).then(({ prev: p, next: n }) => {
        setPrev(p)
        setNext(n)
      }).catch(() => {})
    }, [chunk.fileId, chunk.chunkIndex])

    const meta = [
      chunk.sectionTitle,
      chunk.pageNumber ? `Page ${chunk.pageNumber}` : null,
      chunk.sheetName,
      file.project,
    ].filter(Boolean).join(' · ')

    function copyExcerpt() {
      const label = chunk.sectionTitle ?? (chunk.pageNumber ? `Page ${chunk.pageNumber}` : '')
      navigator.clipboard.writeText(`"${chunk.text}" — ${file.name}, ${label}, ${file.project ?? ''}`)
    }

    return (
      <div className="flex flex-col h-full border-l border-border bg-surface">
        {/* Header */}
        <div className="flex items-start justify-between px-4 py-3 border-b border-border">
          <div>
            <div className="text-sm font-medium text-text-primary">{file.name}</div>
            {meta && <div className="text-xs text-text-secondary mt-0.5">{meta}</div>}
          </div>
          <button
            aria-label="close preview"
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary ml-2 shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Navigation */}
        <div className="flex gap-2 px-4 py-2 border-b border-border text-xs">
          <button
            disabled={!prev}
            onClick={() => prev && window.kordaAPI.knowledgeAdjacent(chunk.fileId, chunk.chunkIndex - 1)}
            className="disabled:opacity-40 hover:text-accent"
          >
            ← Prev chunk
          </button>
          <button
            disabled={!next}
            onClick={() => next && window.kordaAPI.knowledgeAdjacent(chunk.fileId, chunk.chunkIndex + 1)}
            className="disabled:opacity-40 hover:text-accent ml-auto"
          >
            Next chunk →
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 text-sm text-text-primary whitespace-pre-wrap">
          {chunk.text}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-4 py-3 border-t border-border text-xs">
          <button
            onClick={() => window.kordaAPI.fileIndexOpen(file.path)}
            className="px-3 py-1.5 bg-accent text-white rounded hover:bg-accent/80"
          >
            Open File
          </button>
          <button
            onClick={copyExcerpt}
            className="px-3 py-1.5 border border-border rounded text-text-secondary hover:text-text-primary"
          >
            Copy Excerpt
          </button>
        </div>
      </div>
    )
  }
  ```

- [ ] Run: `npx vitest run src/renderer/modules/knowledge/components/ChunkPreview.test.tsx`
      Expected: PASS

- [ ] Commit:
  ```bash
  git add src/renderer/modules/knowledge/components/ChunkPreview.tsx \
          src/renderer/modules/knowledge/components/ChunkPreview.test.tsx
  git commit -m "feat(3a): ChunkPreview panel with adjacent navigation and TDD"
  ```

---

### Task 20: KnowledgeModule (TDD) + module files

**Files — CREATE:**

- `src/renderer/modules/knowledge/KnowledgeModule.tsx`
- `src/renderer/modules/knowledge/KnowledgeModule.test.tsx`
- `src/renderer/modules/knowledge/index.ts`

- [ ] Write the failing test:

  ```typescript
  import { render, screen, fireEvent, waitFor } from '@testing-library/react'
  import { KnowledgeModule } from './KnowledgeModule'
  import type { RetrievalResult, IngestionStatus } from '../../../../shared/ipc-types'

  const idleStatus: IngestionStatus = {
    new: 0, queued: 0, extracting: 0, chunking: 0, contextualizing: 0,
    indexed: 50, failed: 0, skipped: 0, total: 50, totalChunks: 1000, avgChunksPerFile: 20,
  }

  beforeEach(() => {
    Object.defineProperty(window, 'kordaAPI', {
      value: {
        knowledgeSearch: vi.fn().mockResolvedValue([]),
        ingestionStatus: vi.fn().mockResolvedValue(idleStatus),
        fileIndexSourcesList: vi.fn().mockResolvedValue([]),
        fileIndexProjectsList: vi.fn().mockResolvedValue([]),
        onIngestionProgress: vi.fn().mockReturnValue(() => {}),
        ingestionRetry: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
    })
  })

  describe('KnowledgeModule', () => {
    it('renders the search bar', () => {
      render(<KnowledgeModule />)
      expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument()
    })

    it('calls knowledgeSearch on Enter', async () => {
      render(<KnowledgeModule />)
      const input = screen.getByPlaceholderText(/search/i)
      fireEvent.change(input, { target: { value: 'fire rated' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await waitFor(() => expect(window.kordaAPI.knowledgeSearch).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'fire rated' })
      ))
    })

    it('shows empty state when no results', async () => {
      render(<KnowledgeModule />)
      const input = screen.getByPlaceholderText(/search/i)
      fireEvent.change(input, { target: { value: 'xyz' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      await waitFor(() => expect(screen.getByText(/search your indexed/i)).toBeInTheDocument())
    })
  })
  ```

- [ ] Run: `npx vitest run src/renderer/modules/knowledge/KnowledgeModule.test.tsx`
      Expected: FAIL

- [ ] Create `src/renderer/modules/knowledge/KnowledgeModule.tsx`:

  ```typescript
  import { useState, useEffect, useCallback, useRef } from 'react'
  import type { RetrievalResult, IngestionStatus, RetrievalParams } from '../../../../shared/ipc-types'
  import { KnowledgeResults } from './components/KnowledgeResults'
  import { ChunkPreview } from './components/ChunkPreview'
  import { KnowledgeStatusBanner } from './components/KnowledgeStatusBanner'

  export function KnowledgeModule() {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<RetrievalResult[]>([])
    const [selected, setSelected] = useState<RetrievalResult | null>(null)
    const [loading, setLoading] = useState(false)
    const [status, setStatus] = useState<IngestionStatus | null>(null)
    const [lastQuery, setLastQuery] = useState('')

    const pollStatus = useCallback(async () => {
      try {
        const s = await window.kordaAPI.ingestionStatus()
        setStatus(s)
      } catch { /* ignore */ }
    }, [])

    useEffect(() => {
      pollStatus()
      const interval = setInterval(pollStatus, 10_000)
      const unsub = window.kordaAPI.onIngestionProgress(() => pollStatus())
      return () => {
        clearInterval(interval)
        unsub()
      }
    }, [pollStatus])

    async function search(q: string) {
      if (!q.trim()) return
      setLoading(true)
      setLastQuery(q)
      try {
        const r = await window.kordaAPI.knowledgeSearch({ query: q, limit: 20 })
        setResults(r)
        setSelected(null)
      } catch { /* ignore */ } finally {
        setLoading(false)
      }
    }

    function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      if (e.key === 'Enter') search(query)
    }

    return (
      <div className="flex flex-col h-full">
        <KnowledgeStatusBanner
          status={status}
          onRetry={() => window.kordaAPI.ingestionRetry()}
        />
        <div className="px-4 py-3 border-b border-border">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search indexed engineering documents…"
            className="w-full px-3 py-2 text-sm bg-surface-raised border border-border rounded
                       text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className={`overflow-y-auto ${selected ? 'w-3/5' : 'w-full'}`}>
            {loading ? (
              <div className="px-4 py-8 text-center text-text-secondary text-sm">Searching…</div>
            ) : (
              <KnowledgeResults results={results} onSelect={setSelected} query={lastQuery} />
            )}
          </div>
          {selected && (
            <div className="w-2/5 border-l border-border overflow-hidden">
              <ChunkPreview result={selected} onClose={() => setSelected(null)} />
            </div>
          )}
        </div>
      </div>
    )
  }
  ```

- [ ] Create `src/renderer/modules/knowledge/index.ts`:

  ```typescript
  import { BookOpen } from 'lucide-react'
  import type { ModuleDefinition } from '../../shared/types'

  export const definition: ModuleDefinition = {
    id: 'knowledge',
    label: 'Knowledge',
    icon: BookOpen,
    group: 'work',
    order: 2, // between Projects (1) and Chat (3) — adjust to match existing orders
    route: '/knowledge',
    component: () => import('./KnowledgeModule').then((m) => ({ default: m.KnowledgeModule })),
  }
  ```

- [ ] Run: `npx vitest run src/renderer/modules/knowledge/KnowledgeModule.test.tsx`
      Expected: PASS

- [ ] Commit:
  ```bash
  git add src/renderer/modules/knowledge/
  git commit -m "feat(3a): KnowledgeModule with search, preview, status banner and TDD"
  ```

---

### Task 21: Register Knowledge module

**Files — MODIFY:**

- `src/renderer/moduleRegistry.ts`
- `src/renderer/router.tsx` (if routes are declared separately — check the file)

- [ ] Read `src/renderer/moduleRegistry.ts`. Currently imports and registers: home, projects, chat, bookmarks, systemStatus, settings.
- [ ] Add import: `import { definition as knowledge } from './modules/knowledge'`
- [ ] Add `knowledge` to the `modules` array between `projects` and `chat`.
- [ ] Check `src/renderer/router.tsx` (or wherever routes are declared) — add a route for `/knowledge` → `KnowledgeModule` if routes are not derived from `modules` automatically.
- [ ] Run `npx tsc --noEmit` — zero errors.
- [ ] Commit:
  ```bash
  git add src/renderer/moduleRegistry.ts src/renderer/router.tsx
  git commit -m "feat(3a): register Knowledge module in sidebar"
  ```

---

## Chunk 7: Settings + System Status

### Task 22: AI Settings — new fields

**File — MODIFY:** `src/renderer/modules/settings/pages/AI.tsx`

Read this file before editing. The AI settings page has existing fields for API key, model, and firm context.

- [ ] Add three new UI sections after the existing fields:

  **Voyage AI section** (key input + status — key stored as `ai.voyageApiKey`):

  ```
  Voyage AI API Key   [masked input]
                      ✓ Semantic search enabled (voyage-3) — shown when key present
  ```

  **Cohere section** (key input — `ai.cohereApiKey`):

  ```
  Cohere API Key      [masked input]
                      ✓ Reranking enabled (rerank-v3.5) — shown when key present
  ```

  **Contextual Enrichment** (toggle — `ai.contextualEnrichment`):

  ```
  Contextual Retrieval  [toggle]
    Uses Claude to generate a context sentence for each chunk during ingestion.
    Estimated cost: ~$0.04 per 1,000 chunks (Haiku) / ~$0.40 (Sonnet).
    ⚠ Requires re-indexing all files after enabling.
  ```

- [ ] Use the existing pattern for persisting fields — `storeGet('ai')` / `storeSet('ai', updated)` — matching the current page's approach exactly.
- [ ] Run `npx tsc --noEmit` — zero errors.
- [ ] Commit:
  ```bash
  git add src/renderer/modules/settings/pages/AI.tsx
  git commit -m "feat(3a): AI Settings — Voyage AI, Cohere, contextual enrichment fields"
  ```

---

### Task 23: Connections page — per-source ingestion status

**File — MODIFY:** `src/renderer/modules/settings/pages/Connections.tsx`

Read this file before editing. Each source row in the list shows: icon, displayName, enabled badge, online/offline badge, path, fileCount, lastCrawledMs, crawlError.

- [ ] Add ingestion status to each source row. After the existing file count line, add:

  ```typescript
  // Fetch ingestion status per source alongside the existing loadSources() call
  // Add: const ingStatus = await window.kordaAPI.ingestionStatus(source.id)
  // Store as: setIngestionStatuses(prev => ({ ...prev, [source.id]: ingStatus }))
  ```

- [ ] In each source row, display a status pill:
  ```
  ✓ 1,204 indexed  [3 failed — click to expand]  [12 queued]
  ```
- [ ] When "failed" count is clicked, show an inline expansion listing failed filenames and errors. Get this by querying `ingestionStatus(source.id)` — the status already has the count. For the file list, add a new IPC handler `ingestion:failed-files` if needed, or query via existing `knowledgeSearch` with `pipeline_state` filter — check spec for guidance and keep it simple.
- [ ] Add a `[Retry Failed]` button per source that calls `ingestionRetry(source.id)`.
- [ ] Run `npx tsc --noEmit` — zero errors.
- [ ] Commit:
  ```bash
  git add src/renderer/modules/settings/pages/Connections.tsx
  git commit -m "feat(3a): Connections page — per-source ingestion status and retry"
  ```

---

### Task 24: System Status — Knowledge Base panel

**File — MODIFY:** `src/renderer/modules/system-status/SystemStatusModule.tsx`

Read this file before editing. Add a "Knowledge Base" section showing overall ingestion metrics.

- [ ] Fetch `ingestionStatus()` (no sourceId) in the component's data loading.
- [ ] Render the panel:
  ```
  Knowledge Base
  ──────────────────────────────
  Files indexed          1,201
  Chunks indexed        24,819
  Avg chunks/file           20
  Files failed               3    [View Failed → link to Connections page]
  Files skipped             47
  Search mode           Keyword   (add Voyage AI key for semantic)
  Contextual enrichment    OFF    (enable in AI Settings)
  ```
- [ ] "Search mode" reads `aiConfig.voyageApiKey` — shows "Keyword" if absent, "Semantic (voyage-3)" if present.
- [ ] "Contextual enrichment" reads `aiConfig.contextualEnrichment`.
- [ ] Run `npx tsc --noEmit` — zero errors.
- [ ] Commit:
  ```bash
  git add src/renderer/modules/system-status/SystemStatusModule.tsx
  git commit -m "feat(3a): System Status — Knowledge Base panel with ingestion metrics"
  ```

---

## Chunk 8: Final Verification

### Task 25: Full test suite + smoke test

- [ ] Run full test suite:

  ```bash
  npx vitest run
  ```

  Expected: All tests pass. Note any failures and fix before proceeding.

- [ ] TypeScript check:

  ```bash
  npx tsc --noEmit
  ```

  Expected: Zero errors.

- [ ] Start the app:

  ```bash
  npm start
  ```

  Expected:
  - App opens without errors in DevTools console
  - "Knowledge" appears in sidebar between Projects and Chat
  - Navigating to Knowledge shows the search bar
  - Settings → Connections shows ingestion status pills
  - Settings → AI has the Voyage AI / Cohere / Contextual Enrichment fields
  - If a file source is configured with .pdf/.docx/.xlsx/.txt files, files begin ingesting (check DevTools for ingestion:progress events)

- [ ] Smoke test knowledge search:
  1. Ensure at least one file source is configured in Settings → Connections
  2. Wait for some files to reach `pipeline_state = 'indexed'` (watch KnowledgeStatusBanner)
  3. Type a keyword from one of your documents into the Knowledge search bar
  4. Press Enter — verify results appear with highlights
  5. Click a result — verify ChunkPreview opens on the right
  6. Click "← Prev chunk" / "Next chunk →" — verify navigation works
  7. Click "Open File" — verify the file opens in the OS default app

- [ ] Final commit:
  ```bash
  git add -A
  git commit -m "feat(3a): Phase 3A RAG Foundation complete — ingestion pipeline, FTS5 retrieval, Knowledge Search module"
  ```

---

## File Map Summary

### Create

```
src/shared/contracts/
  agent-tool-contract.ts
  llm-provider.ts
  index-record.ts
  chunk-record.ts
  retrieval-contract.ts
  citation-contract.ts

src/main/extractors/
  text-extractor.ts + test
  pdf-extractor.ts + test
  docx-extractor.ts + test
  xlsx-extractor.ts + test

src/main/
  chunker.ts + test
  ingestionWorker.ts
  ingestionWorker.integration.test.ts
  ingestionQueue.ts + test
  retrievalService.ts + test

src/renderer/modules/knowledge/
  index.ts
  KnowledgeModule.tsx + test
  components/
    KnowledgeStatusBanner.tsx + test
    KnowledgeResults.tsx + test
    ChunkPreview.tsx + test
```

### Modify

```
src/shared/ai-config.ts          — voyageApiKey, cohereApiKey, contextualEnrichment
src/shared/ipc-types.ts          — IngestionStatus, IngestionProgressEvent, 5 new channels
src/main/fileIndexService.ts     — schema migration, crawlSource, deleteSourceData, getDb()
src/main/llmClient.ts            — implements LLMProvider, streamWithTools stub
src/main/main.ts                 — 4 new IPC handlers, init order
src/preload/preload.ts           — 5 new bridges
src/renderer/moduleRegistry.ts  — knowledge module registered
src/renderer/router.tsx          — /knowledge route
src/renderer/modules/settings/pages/AI.tsx        — 3 new fields
src/renderer/modules/settings/pages/Connections.tsx — ingestion status per source
src/renderer/modules/system-status/SystemStatusModule.tsx — Knowledge Base panel
```
