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
4. **Mode gate** — the semantic query deliberately _fails_ (no citation or no key fact) under
   keyword mode, confirming the vector path is doing real work and BM25 alone cannot satisfy it.
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
│   ├── Navigate to Knowledge module, select PROJ-003 scope (so grounded chat is active)
│   ├── configureAISettings({ voyageApiKey, anthropicApiKey, retrievalMode: 'auto', useReranking: false })
│   └── set file server root to __testdata__ root, click "Save", await 'Indexing started'
│
├── describe: "Embedding Pipeline"   [@expensive]
│   ├── test: indexing completes — PROJ-003 appears in file index within 15 s
│   ├── test: all chunks reach isReady — waitForEmbeddingReady(page, 90_000)
│   ├── test: hasProvider is true (stats.hasProvider === true)
│   └── test: percent reaches 100 (stats.percent === 100)
│
├── describe: "Keyword Mode"   [@expensive]
│   ├── beforeEach: configureAISettings({ retrievalMode: 'keyword' })
│   ├── test: keyword query returns citation — "What is the SPT N-value in the fill layer?"
│   │         → citation.fileName contains 'Riverfront_Plaza'
│   │         → responseText matches /3.*8|N.?value.*fill|fill.*N.?value/i
│   └── test: semantic query does not retrieve key fact — "What load can the soil safely support?"
│             → citations absent OR responseText does not match /120\s*kPa/i
│             (proves vector path is needed — BM25 alone cannot satisfy this query)
│
├── describe: "Hybrid Mode"   [@expensive]
│   ├── beforeEach: configureAISettings({ retrievalMode: 'auto' })
│   ├── test: semantic query succeeds — "What load can the soil safely support?"
│   │         → citation.fileName contains 'Riverfront_Plaza'
│   │         → responseText matches /120\s*kPa|bearing capacity.*120|120.*allowable/i
│   ├── test: liquefaction query succeeds — "Is the site at risk during an earthquake?"
│   │         → responseText matches /liquefaction|0\.18g|seismic/i
│   └── test: synthesis query spans sections — "Summarise the foundation options and risks"
│             → responseText matches /piles?|14\s*m/i
│             → responseText matches /120|bearing capacity/i
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

**Navigation path:** `page.click('a[href="/settings"]')` → click the "AI" sub-nav link → fill
fields → click "Save AI Settings" → await confirmation text `"AI settings saved."`.

The success confirmation is a `<span>` with class containing `aiFeedback` that shows
`"AI settings saved."` — **not** `"✓ Saved"` (that text only exists on the Connections page).

Accepts partial settings — only provided fields are written, others are left as-is.

```typescript
interface AITestSettings {
  voyageApiKey?: string
  anthropicApiKey?: string
  retrievalMode?: 'keyword' | 'hybrid' | 'auto'
  useReranking?: boolean
}

async function configureAISettings(page: Page, settings: AITestSettings): Promise<void>
```

**Selectors:**

| Field                               | Playwright selector                            |
| ----------------------------------- | ---------------------------------------------- |
| Voyage API key input                | `#voyage-api-key`                              |
| Anthropic API key input             | `#anthropic-api-key`                           |
| Retrieval mode radio (e.g. keyword) | `input[name="retrievalMode"][value="keyword"]` |
| Use reranking checkbox              | `#use-reranking`                               |
| Save button                         | `button:has-text("Save AI Settings")`          |
| Success confirmation                | `text=AI settings saved.`                      |

### 5.2 `waitForEmbeddingReady(page, timeoutMs)`

Polls `window.kordaAPI.getEmbeddingStats()` via `page.evaluate` every 2 seconds until
`stats.isReady === true`. The IPC method is exposed as `kordaAPI.getEmbeddingStats` in
`preload.ts`. Throws a descriptive error on timeout:

```
EmbeddingReadyTimeout: Embeddings not ready after 90 000 ms.
  Last stats: { embedded: 14, total: 22, percent: 63, isReady: false, hasProvider: true }
  Check: VOYAGE_API_KEY is set and valid, Voyage API is reachable
```

### 5.3 `sendChatMessage(page, text)` → `ChatResponse`

**Prerequisite:** The chat module must be in grounded mode with a knowledge scope selected. The
`beforeAll` sets this up by selecting the PROJ-003 scope via the `ScopeSelector` component
before sending any messages.

Types `text` into the chat input (`[aria-label="Message input"]` or the textarea in
`ChatInput.tsx`), submits, calls `waitForStreamComplete(page)`, then calls
`getCitationsFromLastMessage(page)`, and returns:

```typescript
interface ChatResponse {
  text: string // full assistant message text content
  citations: Citation[]
}
```

### 5.4 `getCitationsFromLastMessage(page)` → `Citation[]`

`CitationPanel` renders **collapsed by default** (`defaultOpen = false`). This helper must
first click the expand toggle — `[aria-label="Show sources"]` on the last assistant message
bubble — before reading citation rows. If the toggle reads `[aria-label="Hide sources"]` the
panel is already expanded.

After expanding, reads each citation row to return:

```typescript
interface Citation {
  fileName: string // matches citation.fileName in the actual Citation contract
  excerpt: string
}
```

### 5.5 `waitForStreamComplete(page, timeoutMs)`

The streaming state is reflected in the chat input: while streaming, a Stop button
(`[aria-label="Stop response"]`) is visible; when streaming ends, the Send button
(`[aria-label="Send message"]`) reappears.

```typescript
await page.locator('[aria-label="Send message"]').waitFor({ state: 'visible', timeout: timeoutMs })
```

Default timeout: 30 000 ms.

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
expect(citations[0].fileName).toContain('Riverfront_Plaza')
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
evidence of weak or absent retrieval. The assertion is **always explicit** — it does not pass
vacuously if no citations are returned:

```typescript
const { text: responseText, citations } = await sendChatMessage(
  page,
  'What load can the soil safely support?',
)
const hasStrongCitation = citations.some((c) => c.fileName.includes('Riverfront_Plaza'))
const hasKeyFact = /120\s*kPa/i.test(responseText)

// At least one of these must be true: no strong citation, or key fact absent from response
expect(hasStrongCitation && hasKeyFact).toBe(false)
```

This assertion fails if BM25 somehow retrieves the right chunk AND the AI happens to quote
`120 kPa` — which would indicate the vector gate is not working as expected.

---

## 7. Package.json Changes

Two changes needed:

**1. Add `cross-env` to devDependencies** (required for Windows-compatible env var injection
in npm scripts):

```bash
npm install --save-dev cross-env
```

**2. Add `test:e2e:full` script** (plus matching `pre`/`post` hooks so native modules are
rebuilt, matching the pattern of the existing `test:e2e` hooks):

```json
{
  "scripts": {
    "pretest:e2e:full": "<same as pretest:e2e — electron-rebuild command>",
    "test:e2e:full": "cross-env playwright test e2e/ragPipeline.spec.ts",
    "posttest:e2e:full": "<same as posttest:e2e — npm rebuild better-sqlite3>"
  }
}
```

Copy the exact command strings from the existing `pretest:e2e` and `posttest:e2e` entries.
The normal `test:e2e` script remains unchanged.

---

## 8. Fixture Generation

The fixture PDF is committed as a binary to the repo. It is generated **once** by a developer
using a one-off build script — tests never re-generate it at runtime.

**`scripts/generateRagFixture.ts`**

Uses `pdf-lib` to create `Riverfront_Plaza_Geotech_Report.pdf` with the content from
Section 3. Before running, install `pdf-lib` as a dev dependency:

```bash
npm install --save-dev pdf-lib
```

Run once:

```bash
npx ts-node scripts/generateRagFixture.ts
```

Then commit the generated PDF binary. `pdf-lib` remains in `devDependencies` (it is also
useful for future fixture updates).

---

## 9. File Map

| Action | Path                                                                                   |
| ------ | -------------------------------------------------------------------------------------- |
| CREATE | `e2e/ragPipeline.spec.ts`                                                              |
| CREATE | `e2e/fixtures/configureAISettings.ts`                                                  |
| CREATE | `e2e/fixtures/waitForEmbeddingReady.ts`                                                |
| CREATE | `e2e/fixtures/sendChatMessage.ts`                                                      |
| CREATE | `e2e/fixtures/getCitationsFromLastMessage.ts`                                          |
| CREATE | `e2e/fixtures/waitForStreamComplete.ts`                                                |
| CREATE | `scripts/generateRagFixture.ts`                                                        |
| CREATE | `src/main/__testdata__/projects/PROJ-003/Riverfront_Plaza_Geotech_Report.pdf` (binary) |
| MODIFY | `package.json` (add `cross-env` devDep, `test:e2e:full` + pre/post hooks)              |
