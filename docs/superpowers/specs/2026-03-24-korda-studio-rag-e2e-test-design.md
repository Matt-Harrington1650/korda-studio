# RAG Pipeline E2E Test Suite — Design Spec

**Date:** 2026-03-24
**Scope:** End-to-end Playwright test suite that verifies the full Phase 3C semantic search
pipeline — embedding generation, keyword mode, hybrid BM25+vector mode, and Cohere reranking
toggle — against a real Electron app with live API calls.

---

## 1. Goals

Prove that the Phase 3C RAG stack works correctly end-to-end in a real Electron process:

1. **Embedding pipeline** — `EmbeddingLoop` embeds all chunks for a new fixture file and
   reports `isReady: true` via `EMBEDDING_STATS` IPC.
2. **Keyword mode** — `retrievalMode: 'keyword'` retrieves chunks containing exact terms and
   the grounded chat response cites the correct file.
3. **Hybrid mode** — `retrievalMode: 'auto'` retrieves semantically relevant chunks even when
   the query shares no keywords with the source text, proving the vector path is active.
4. **Mode gate** — the semantic query deliberately _fails_ (no citation) under keyword mode,
   confirming the vector path is doing real work and BM25 alone cannot satisfy it.
5. **Reranking toggle** — enabling `useReranking` does not break retrieval; the same citation
   still appears.

---

## 2. Test Classification

| Property            | Value                                            |
| ------------------- | ------------------------------------------------ |
| Framework           | Playwright (existing `e2e/` setup)               |
| Tag                 | `@expensive`                                     |
| Run command         | `npm run test:e2e:full`                          |
| Normal CI           | **skipped** (no `VOYAGE_API_KEY`)                |
| Required env vars   | `VOYAGE_API_KEY`, `ANTHROPIC_API_KEY`            |
| Estimated wall time | ~3–5 minutes (dominated by embedding generation) |

**Environment guard** — at the top of the spec, before any `test.describe`:

```typescript
test.skip(
  !process.env.VOYAGE_API_KEY || !process.env.ANTHROPIC_API_KEY,
  'Skipped: set VOYAGE_API_KEY + ANTHROPIC_API_KEY to run RAG pipeline tests',
)
```

---

## 3. Fixture File

**Path:** `src/main/__testdata__/projects/PROJ-003/Riverfront_Plaza_Geotech_Report.pdf`

A synthetic geotechnical investigation report for "42 Riverfront Avenue". Generated as a real
PDF using `pdf-lib` in a one-off build script committed alongside the fixture. Content is
structured so that:

- **Keyword-friendly facts** contain exact engineering terms present verbatim in the text
- **Semantic-only facts** are paraphraseable questions with zero word overlap to the source
- **Cross-section synthesis** requires combining information from two or more sections

### 3.1 Content Outline

| Section                        | Key Facts for Test Assertions                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------- |
| 1. Executive Summary           | Site at 42 Riverfront Ave; 3 boreholes (BH-1, BH-2, BH-3); 6 m fill layer                           |
| 2. Soil Profile & Stratigraphy | SPT N-values: 3–8 in fill, 22–35 in dense gravel below 6 m                                          |
| 3. Foundation Recommendations  | Allowable bearing capacity **120 kPa** at 2.5 m depth; driven piles to **14 m** as alternative      |
| 4. Groundwater Conditions      | Depth **1.8 m**; seasonal variation ±0.5 m; dewatering required during construction                 |
| 5. Seismic & Liquefaction      | Loose saturated sands at 1–4 m susceptible to liquefaction; peak ground acceleration **Ia = 0.18g** |

### 3.2 Semantic Query Design

| Query                                                            | Retrieval path needed         | Target section | Key fact in response        |
| ---------------------------------------------------------------- | ----------------------------- | -------------- | --------------------------- |
| `"What is the SPT N-value in the fill layer?"`                   | Keyword (exact match)         | Section 2      | `3–8` or `N-value`          |
| `"What load can the soil safely support?"`                       | Vector only (no shared words) | Section 3      | `120` or `bearing capacity` |
| `"Is the site at risk of ground movement during an earthquake?"` | Vector only                   | Section 5      | `liquefaction` or `0.18g`   |
| `"Summarise the foundation options and their risks"`             | Hybrid synthesis              | Sections 3 + 5 | Both `120 kPa` and `piles`  |

---

## 4. Test File Structure

**New file:** `e2e/ragPipeline.spec.ts`

```
ragPipeline.spec.ts
│
├── Environment guard (skip if keys absent)
│
├── beforeAll
│   ├── launchApp()
│   ├── configureAISettings({ voyageApiKey, anthropicApiKey, retrievalMode: 'auto', useReranking: false })
│   └── set file server root to __testdata__ root, click Save, await 'Indexing started'
│
├── describe: "Embedding Pipeline"   [@expensive]
│   ├── test: indexing completes — PROJ-003 appears in file index within 15 s
│   ├── test: embedding progress events fire — EMBEDDING_PROGRESS received at least once
│   ├── test: all chunks reach isReady — waitForEmbeddingReady(page, 90_000)
│   ├── test: hasProvider is true
│   └── test: percent reaches 100
│
├── describe: "Keyword Mode"   [@expensive]
│   ├── beforeEach: configureAISettings({ retrievalMode: 'keyword' })
│   ├── test: keyword query returns citation — "What is the SPT N-value in the fill layer?"
│   │         → citation.filename contains 'Riverfront_Plaza'
│   │         → responseText matches /3.*8|N.value.*fill|fill.*N.value/i
│   └── test: semantic query finds nothing useful — "What load can the soil safely support?"
│             → no citation OR citation.relevanceScore below threshold
│             (proves vector path is needed — this test is expected to produce weak/no citation)
│
├── describe: "Hybrid Mode"   [@expensive]
│   ├── beforeEach: configureAISettings({ retrievalMode: 'auto' })
│   ├── test: semantic query succeeds — "What load can the soil safely support?"
│   │         → citation.filename contains 'Riverfront_Plaza'
│   │         → responseText matches /120\s*kPa|bearing capacity.*120|120.*allowable/i
│   ├── test: liquefaction query succeeds — "Is the site at risk during an earthquake?"
│   │         → responseText matches /liquefaction|0\.18g|seismic/i
│   └── test: synthesis query spans sections — "Summarise the foundation options and risks"
│             → responseText contains both 'piles' (or '14 m') and '120'
│
├── describe: "Reranking Toggle"   [@expensive]
│   ├── beforeEach: configureAISettings({ retrievalMode: 'auto', useReranking: true })
│   ├── test: reranking does not break retrieval — semantic query still cites correct file
│   └── test: reranking does not break keyword query — SPT query still returns N-value fact
│
└── afterAll
    ├── reset AI settings to defaults
    └── closeApp()
```

---

## 5. Test Helpers

All helpers live in `e2e/fixtures/` alongside the existing `launchApp.ts` and `testDataDir.ts`.

### 5.1 `configureAISettings(page, settings)`

Navigates to Settings → AI page, fills the form fields, clicks Save, awaits the `✓ Saved`
confirmation. Accepts partial settings — only provided fields are written, others are left as-is.

```typescript
interface AITestSettings {
  voyageApiKey?: string
  anthropicApiKey?: string
  retrievalMode?: 'keyword' | 'vector' | 'hybrid' | 'auto'
  useReranking?: boolean
}

async function configureAISettings(page: Page, settings: AITestSettings): Promise<void>
```

### 5.2 `waitForEmbeddingReady(page, timeoutMs)`

Polls `window.kordaAPI.getEmbeddingStats()` via `page.evaluate` every 2 seconds until
`stats.isReady === true`. Throws a descriptive error on timeout:

```
EmbeddingReadyTimeout: Embeddings not ready after 90 000 ms.
  Last stats: { embedded: 14, total: 22, percent: 63, isReady: false, hasProvider: true }
  Check: VOYAGE_API_KEY is set and valid, Voyage API is reachable
```

### 5.3 `sendChatMessage(page, text)` → `ChatResponse`

Types `text` into the chat input, submits, waits for the streaming indicator to disappear
(stream complete), then returns:

```typescript
interface ChatResponse {
  text: string // full assistant message text
  citations: Citation[] // citation chips parsed from the DOM
}
```

### 5.4 `getCitationsFromLastMessage(page)` → `Citation[]`

Reads citation chips rendered below the last assistant message bubble. Returns:

```typescript
interface Citation {
  filename: string
  excerpt: string
}
```

### 5.5 `waitForStreamComplete(page, timeoutMs)`

Waits for the streaming spinner/indicator in the chat UI to disappear, indicating the assistant
response has fully streamed. Default timeout: 30 000 ms.

---

## 6. Assertion Strategy

### 6.1 Pipeline assertions (deterministic)

```typescript
const stats = await page.evaluate(() => window.kordaAPI.getEmbeddingStats())
expect(stats.hasProvider).toBe(true)
expect(stats.isReady).toBe(true)
expect(stats.percent).toBe(100)
expect(stats.embedded).toBe(stats.total)
```

### 6.2 Citation assertions

```typescript
const citations = await getCitationsFromLastMessage(page)
expect(citations.length).toBeGreaterThan(0)
expect(citations[0].filename).toContain('Riverfront_Plaza')
```

### 6.3 Response content assertions (flexible regex)

AI phrasing varies between runs. Assert facts, not exact wording:

```typescript
// SPT N-value
expect(responseText).toMatch(/3.*8|N.?value.*fill|fill.*N.?value/i)

// Bearing capacity
expect(responseText).toMatch(/120\s*kPa|bearing capacity.*120|120.*allowable/i)

// Liquefaction
expect(responseText).toMatch(/liquefaction|0\.18g|seismic amplification/i)

// Synthesis: both piles and bearing capacity present
expect(responseText).toMatch(/piles?|14\s*m/i)
expect(responseText).toMatch(/120|bearing capacity/i)
```

### 6.4 Mode-gate assertion (keyword mode fails semantic query)

In keyword mode, the semantic query `"What load can the soil safely support?"` must produce
evidence of weak or absent retrieval. Assert at least one of:

```typescript
const citations = await getCitationsFromLastMessage(page)
const hasStrongCitation = citations.some((c) => c.filename.includes('Riverfront_Plaza'))
// Either no citation at all, or the response doesn't contain the key fact
if (hasStrongCitation) {
  // If keyword mode somehow retrieves it, the fact must be absent — BM25 got lucky on tokens
  // but the response will be vague or wrong
  expect(responseText).not.toMatch(/120\s*kPa/i)
}
```

---

## 7. Package.json Changes

```json
{
  "scripts": {
    "test:e2e:full": "cross-env playwright test e2e/ragPipeline.spec.ts"
  }
}
```

The normal `test:e2e` script remains unchanged and does not include `ragPipeline.spec.ts`.

---

## 8. Fixture Generation

The fixture PDF is committed as a binary to the repo. It is generated once by a build script:

**`scripts/generateRagFixture.ts`**

Uses `pdf-lib` to create `Riverfront_Plaza_Geotech_Report.pdf` programmatically with the
content from Section 3. The script is run once by a developer and the output committed — tests
never re-generate it at runtime. This avoids `pdf-lib` as a test runtime dependency.

---

## 9. File Map

| Action | Path                                                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------------- |
| CREATE | `e2e/ragPipeline.spec.ts`                                                                                   |
| CREATE | `e2e/fixtures/configureAISettings.ts`                                                                       |
| CREATE | `e2e/fixtures/waitForEmbeddingReady.ts`                                                                     |
| CREATE | `e2e/fixtures/sendChatMessage.ts`                                                                           |
| CREATE | `e2e/fixtures/getCitationsFromLastMessage.ts`                                                               |
| CREATE | `e2e/fixtures/waitForStreamComplete.ts`                                                                     |
| CREATE | `scripts/generateRagFixture.ts`                                                                             |
| CREATE | `src/main/__testdata__/projects/PROJ-003/Riverfront_Plaza_Geotech_Report.pdf` (binary, generated by script) |
| MODIFY | `package.json` (add `test:e2e:full` script)                                                                 |
