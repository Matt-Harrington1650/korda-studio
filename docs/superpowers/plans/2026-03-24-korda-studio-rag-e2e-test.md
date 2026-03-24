# RAG Pipeline E2E Test Suite — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Playwright `@expensive` end-to-end test suite that proves the full Phase 3C RAG pipeline works correctly — embedding generation, keyword mode, hybrid BM25+vector mode, and Cohere reranking toggle — against a live Electron app with real API calls.

**Architecture:** A fixture PDF (`Riverfront_Plaza_Geotech_Report.pdf`) containing 5 sections of synthetic geotechnical data is generated once by a `scripts/generateRagFixture.ts` script and committed as a binary. The test suite (`e2e/ragPipeline.spec.ts`) launches the real Electron app, indexes the fixture, waits for `EmbeddingLoop` to complete, then runs queries across four `describe` blocks verifying keyword, hybrid, and reranked retrieval. Six reusable Playwright helpers in `e2e/fixtures/` encapsulate navigation, embedding polling, and chat interaction.

**Tech Stack:** Playwright, `pdf-lib` (fixture generation only), `cross-env` (Windows npm scripts), TypeScript, Electron IPC (`window.kordaAPI`).

**Spec:** `docs/superpowers/specs/2026-03-24-korda-studio-rag-e2e-test-design.md`

---

## Chunk 1: Setup — Dependencies, App Code Fix, Fixture PDF

### Task 1: Install dependencies and add npm scripts

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install `cross-env`, `pdf-lib`, and `tsx` as dev dependencies**

```bash
cd "C:/code/Korda studio/korda-studio"
npm install --save-dev cross-env pdf-lib tsx
```

Expected output: added 3 packages (or similar). No errors.

- [ ] **Step 2: Read the existing pre/post e2e hooks**

```bash
node -e "const p = require('./package.json'); const s = p.scripts; ['pretest:e2e','test:e2e','posttest:e2e'].forEach(k => console.log(k + ':', s[k]))"
```

Note the exact strings — you will copy them verbatim below.

- [ ] **Step 3: Add `test:e2e:full` + hooks to `package.json` scripts**

In `package.json`, add these three entries to the `"scripts"` object. Copy the exact command
strings from `pretest:e2e` and `posttest:e2e` (step 2 above):

```json
"pretest:e2e:full": "<exact same command as pretest:e2e>",
"test:e2e:full": "cross-env playwright test e2e/ragPipeline.spec.ts",
"posttest:e2e:full": "<exact same command as posttest:e2e>"
```

- [ ] **Step 4: Verify scripts are valid JSON**

```bash
node -e "require('./package.json'); console.log('valid JSON')"
```

Expected: `valid JSON`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(e2e): add cross-env, pdf-lib; add test:e2e:full script"
```

---

### Task 2: Add accessibility attributes to chat components

Two app code changes are required before the Playwright helpers can address the correct DOM
elements:

1. `ChatInput.tsx` textarea has no `aria-label` — add `aria-label="Message input"`
2. `MessageBubble.tsx` `<article>` has no `data-role` attribute — add `data-role={message.role}` so `sendChatMessage` can locate assistant message text

**Files:**

- Modify: `src/renderer/modules/chat/components/ChatInput.tsx`
- Modify: `src/renderer/modules/chat/components/MessageBubble.tsx`

- [ ] **Step 1: Open `ChatInput.tsx` and locate the `<textarea>` element**

Find the `<textarea>` block starting around line 67 (the one with
`placeholder="Ask about standards..."` and no aria-label).

- [ ] **Step 2: Add `aria-label="Message input"` to the textarea**

Change:

```tsx
        <textarea
          ref={(node) => {
```

To:

```tsx
        <textarea
          aria-label="Message input"
          ref={(node) => {
```

- [ ] **Step 3: Open `MessageBubble.tsx` and locate the root `<article>` element**

```bash
grep -n "<article" src/renderer/modules/chat/components/MessageBubble.tsx
```

Find the `<article` tag that wraps each message bubble.

- [ ] **Step 4: Add `data-role={message.role}` to the `<article>` element**

The `<article>` element currently has only `className` and `title` attributes. Add
`data-role` so assistant vs. user messages can be distinguished in Playwright:

```tsx
      <article
        data-role={message.role}
        className={...}
        title={...}
      >
```

The exact className/title values will be what already exists in the file — do not change
them, only insert the `data-role` line.

- [ ] **Step 5: Verify the change compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/chat/components/ChatInput.tsx
git add src/renderer/modules/chat/components/MessageBubble.tsx
git commit -m "feat(a11y): add aria-label + data-role to chat components for e2e testability"
```

---

### Task 3: Write fixture generation script and generate the PDF

**Files:**

- Create: `scripts/generateRagFixture.ts`
- Create: `src/main/__testdata__/projects/PROJ-003/Riverfront_Plaza_Geotech_Report.pdf` (binary, generated by script)

- [ ] **Step 1: Create `scripts/generateRagFixture.ts`**

```typescript
// scripts/generateRagFixture.ts
// Run once: npx tsx scripts/generateRagFixture.ts
// Then commit the generated PDF binary.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// __dirname is not available in ESM — derive it from import.meta.url
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const OUT_PATH = path.resolve(
  __dirname,
  '../src/main/__testdata__/projects/PROJ-003/Riverfront_Plaza_Geotech_Report.pdf',
)

const SECTIONS = [
  {
    title: '1. Executive Summary',
    body: `This geotechnical investigation was carried out for the proposed Riverfront Plaza
development at 42 Riverfront Avenue. Three boreholes (BH-1, BH-2, BH-3) were advanced
to depths of 15 m. The site is underlain by approximately 6 m of loose fill material
overlying dense gravels. The fill layer presents challenges for shallow foundations and
should be considered in all structural design decisions.`,
  },
  {
    title: '2. Soil Profile and Stratigraphy',
    body: `Borehole logs indicate the following stratigraphy from surface:
0–6 m: Loose fill comprising demolition rubble, sand, and clay. Standard Penetration Test
(SPT) N-values range from 3 to 8, indicating very loose to loose consistency.
6–15 m: Dense sandy gravel with cobbles. SPT N-values range from 22 to 35, indicating
dense to very dense material. This stratum provides suitable bearing for foundations.`,
  },
  {
    title: '3. Foundation Recommendations',
    body: `Based on the soil conditions encountered, the following foundation options are recommended:
Shallow Foundations: Strip or pad footings founded at a minimum depth of 2.5 m below
finished floor level, bearing on the dense gravel stratum. The allowable bearing capacity
at this level is 120 kPa. Settlement is estimated at less than 25 mm.
Driven Piles: As an alternative for heavily loaded columns, driven piles should be taken
to a minimum depth of 14 m to develop adequate skin friction and end bearing in the dense
gravel. This option is recommended where column loads exceed 500 kN.`,
  },
  {
    title: '4. Groundwater Conditions',
    body: `Groundwater was encountered during drilling at a depth of 1.8 m below existing ground
level. Seasonal variation of ±0.5 m is anticipated based on regional data. Temporary
dewatering will be required during construction of any excavations below 1.5 m depth.
Permanent waterproofing measures should be provided for all below-ground structures.
Groundwater is classified as mildly aggressive to concrete (Class XA1 per EN 206).`,
  },
  {
    title: '5. Seismic Assessment and Liquefaction',
    body: `The site is located in a moderate seismic zone with a design peak ground acceleration of
Ia = 0.18g. The loose saturated sands within the fill layer between 1 m and 4 m depth are
susceptible to liquefaction during a design earthquake event. Seismic amplification effects
are expected due to the soft fill overlying dense gravel. Mitigation measures including
vibro-compaction or removal and replacement of the fill are recommended prior to
construction. Dynamic compaction is also a viable alternative.`,
  },
]

async function generate(): Promise<void> {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const pageWidth = 595
  const pageHeight = 842
  const marginX = 60
  const marginTop = 60
  const marginBottom = 60
  const lineHeight = 16
  const titleSize = 13
  const bodySize = 11

  // Title page
  let page = pdfDoc.addPage([pageWidth, pageHeight])
  let y = pageHeight - marginTop

  page.drawText('GEOTECHNICAL INVESTIGATION REPORT', {
    x: marginX,
    y: y - 20,
    size: 16,
    font: boldFont,
    color: rgb(0, 0, 0),
  })
  y -= 50

  page.drawText('Riverfront Plaza Development', {
    x: marginX,
    y,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0),
  })
  y -= 24

  page.drawText('42 Riverfront Avenue', {
    x: marginX,
    y,
    size: bodySize,
    font,
    color: rgb(0, 0, 0),
  })
  y -= lineHeight
  page.drawText('Project Reference: PROJ-003', {
    x: marginX,
    y,
    size: bodySize,
    font,
    color: rgb(0, 0, 0),
  })
  y -= lineHeight
  page.drawText('Date: March 2026', {
    x: marginX,
    y,
    size: bodySize,
    font,
    color: rgb(0, 0, 0),
  })

  // Sections
  for (const section of SECTIONS) {
    page = pdfDoc.addPage([pageWidth, pageHeight])
    y = pageHeight - marginTop

    // Section title
    page.drawText(section.title, {
      x: marginX,
      y,
      size: titleSize,
      font: boldFont,
      color: rgb(0, 0, 0),
    })
    y -= titleSize + 8

    // Body text — word-wrap manually
    const maxWidth = pageWidth - marginX * 2
    const words = section.body.replace(/\n/g, ' \n ').split(' ')
    let line = ''

    for (const word of words) {
      if (word === '\n') {
        // Draw current line and add paragraph gap
        if (line.trim()) {
          page.drawText(line.trim(), { x: marginX, y, size: bodySize, font, color: rgb(0, 0, 0) })
          y -= lineHeight
        }
        y -= lineHeight / 2
        line = ''
        continue
      }

      const test = line ? `${line} ${word}` : word
      const testWidth = font.widthOfTextAtSize(test, bodySize)

      if (testWidth > maxWidth && line) {
        page.drawText(line, { x: marginX, y, size: bodySize, font, color: rgb(0, 0, 0) })
        y -= lineHeight
        line = word

        if (y < marginBottom) {
          page = pdfDoc.addPage([pageWidth, pageHeight])
          y = pageHeight - marginTop
        }
      } else {
        line = test
      }
    }

    if (line.trim()) {
      page.drawText(line.trim(), { x: marginX, y, size: bodySize, font, color: rgb(0, 0, 0) })
    }
  }

  const bytes = await pdfDoc.save()
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, bytes)
  console.log(`✓ Written: ${OUT_PATH} (${bytes.byteLength} bytes)`)
}

generate().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Run the script to generate the PDF**

```bash
cd "C:/code/Korda studio/korda-studio"
npx tsx scripts/generateRagFixture.ts
```

Expected output:

```
✓ Written: .../PROJ-003/Riverfront_Plaza_Geotech_Report.pdf (XXXXX bytes)
```

If `tsx` is unavailable, try `npx ts-node --esm scripts/generateRagFixture.ts` or install tsx:
`npm install --save-dev tsx` then retry.

- [ ] **Step 3: Verify the PDF exists and is non-empty**

```bash
ls -lh "src/main/__testdata__/projects/PROJ-003/Riverfront_Plaza_Geotech_Report.pdf"
```

Expected: file size > 10 KB.

- [ ] **Step 4: Commit the script and the generated PDF binary**

```bash
git add scripts/generateRagFixture.ts
git add "src/main/__testdata__/projects/PROJ-003/Riverfront_Plaza_Geotech_Report.pdf"
git commit -m "feat(e2e): add RAG fixture PDF and generation script"
```

---

## Chunk 2: Test Helpers

### Task 4: `waitForStreamComplete` and `configureAISettings`

**Files:**

- Create: `e2e/fixtures/waitForStreamComplete.ts`
- Create: `e2e/fixtures/configureAISettings.ts`

- [ ] **Step 1: Create `e2e/fixtures/waitForStreamComplete.ts`**

The stream is complete when the Send button (`[aria-label="Send message"]`) becomes visible,
replacing the Stop button (`[aria-label="Stop response"]`).

```typescript
// e2e/fixtures/waitForStreamComplete.ts
import type { Page } from '@playwright/test'

export async function waitForStreamComplete(page: Page, timeoutMs = 30_000): Promise<void> {
  await page
    .locator('[aria-label="Send message"]')
    .waitFor({ state: 'visible', timeout: timeoutMs })
}
```

- [ ] **Step 2: Create `e2e/fixtures/configureAISettings.ts`**

Navigates to Settings → AI, fills only the provided fields, clicks "Save AI Settings",
awaits `"AI settings saved."` confirmation.

**Selector reference:**

- Navigate: `a[href="/settings"]` → click "AI" sub-nav text
- Voyage key: `#voyage-api-key`
- Anthropic key: `#anthropic-api-key`
- Retrieval mode radio: `input[name="retrievalMode"][value="<value>"]`
- Reranking checkbox: `#use-reranking`
- Save: `button:has-text("Save AI Settings")`
- Confirmation: `text=AI settings saved.`

```typescript
// e2e/fixtures/configureAISettings.ts
import type { Page } from '@playwright/test'

export interface AITestSettings {
  voyageApiKey?: string
  anthropicApiKey?: string
  retrievalMode?: 'keyword' | 'hybrid' | 'auto'
  useReranking?: boolean
}

export async function configureAISettings(page: Page, settings: AITestSettings): Promise<void> {
  // Navigate to Settings → AI
  await page.click('a[href="/settings"]')
  await page.getByText('AI', { exact: true }).click()

  if (settings.voyageApiKey !== undefined) {
    await page.locator('#voyage-api-key').fill(settings.voyageApiKey)
  }

  if (settings.anthropicApiKey !== undefined) {
    await page.locator('#anthropic-api-key').fill(settings.anthropicApiKey)
  }

  if (settings.retrievalMode !== undefined) {
    await page.locator(`input[name="retrievalMode"][value="${settings.retrievalMode}"]`).check()
  }

  if (settings.useReranking !== undefined) {
    const checkbox = page.locator('#use-reranking')
    const checked = await checkbox.isChecked()
    if (settings.useReranking !== checked) {
      await checkbox.click()
    }
  }

  await page.click('button:has-text("Save AI Settings")')
  await page.waitForSelector('text=AI settings saved.', { timeout: 5_000 })
}
```

- [ ] **Step 3: Commit**

```bash
git add e2e/fixtures/waitForStreamComplete.ts e2e/fixtures/configureAISettings.ts
git commit -m "feat(e2e): add waitForStreamComplete + configureAISettings helpers"
```

---

### Task 5: `waitForEmbeddingReady`

**Files:**

- Create: `e2e/fixtures/waitForEmbeddingReady.ts`

- [ ] **Step 1: Create `e2e/fixtures/waitForEmbeddingReady.ts`**

Polls `window.kordaAPI.getEmbeddingStats()` every 2 seconds until `stats.isReady === true`.
Throws a descriptive error on timeout so the developer knows exactly what failed.

```typescript
// e2e/fixtures/waitForEmbeddingReady.ts
import type { Page } from '@playwright/test'
import type { EmbeddingStats } from '../../src/shared/contracts/embedding-provider-contract'

export async function waitForEmbeddingReady(
  page: Page,
  timeoutMs = 90_000,
): Promise<EmbeddingStats> {
  const deadline = Date.now() + timeoutMs
  let lastStats: EmbeddingStats | null = null

  while (Date.now() < deadline) {
    const stats = await page.evaluate(() =>
      (
        window as unknown as { kordaAPI: { getEmbeddingStats(): Promise<EmbeddingStats> } }
      ).kordaAPI.getEmbeddingStats(),
    )
    lastStats = stats

    if (stats.isReady) {
      return stats
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 2_000))
  }

  throw new Error(
    `EmbeddingReadyTimeout: Embeddings not ready after ${timeoutMs} ms.\n` +
      `  Last stats: ${JSON.stringify(lastStats)}\n` +
      `  Check: VOYAGE_API_KEY is set and valid, Voyage API is reachable`,
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add e2e/fixtures/waitForEmbeddingReady.ts
git commit -m "feat(e2e): add waitForEmbeddingReady helper"
```

---

### Task 6: `getCitationsFromLastMessage`

**Files:**

- Create: `e2e/fixtures/getCitationsFromLastMessage.ts`

- [ ] **Step 1: Create `e2e/fixtures/getCitationsFromLastMessage.ts`**

`CitationPanel` renders collapsed by default (`defaultOpen = false`). This helper finds
the last assistant message's citation panel toggle button, clicks it to expand, then reads
each citation row's `fileName` and `excerpt` text.

DOM structure (from `CitationPanel.tsx`):

- Toggle button: `[aria-label="Show sources"]` (or `"Hide sources"` if already open)
- Each citation row contains: `.truncate` div (fileName), then excerpt div

```typescript
// e2e/fixtures/getCitationsFromLastMessage.ts
import type { Page } from '@playwright/test'

export interface ParsedCitation {
  fileName: string
  excerpt: string
}

export async function getCitationsFromLastMessage(page: Page): Promise<ParsedCitation[]> {
  // Find the last assistant message that has a citation panel toggle
  const toggleButtons = page.locator('[aria-label="Show sources"], [aria-label="Hide sources"]')
  const count = await toggleButtons.count()
  if (count === 0) {
    return []
  }

  const lastToggle = toggleButtons.nth(count - 1)
  const ariaLabel = await lastToggle.getAttribute('aria-label')

  // Expand if not already open
  if (ariaLabel === 'Show sources') {
    await lastToggle.click()
    // Wait for panel content to render
    await page.waitForTimeout(300)
  }

  // The citation panel is the ancestor container; citations are children
  const panel = lastToggle.locator('..').locator('..')
  const rows = panel.locator('.rounded-xl.border.border-border.bg-surface-raised\\/60')
  const rowCount = await rows.count()

  const citations: ParsedCitation[] = []
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i)
    // fileName is in the .truncate div
    const fileName = (await row.locator('.truncate').textContent()) ?? ''
    // excerpt is in the second text div (after meta)
    const allText = await row.locator('.text-sm.text-text-primary').allTextContents()
    const excerpt = allText.find((t) => t !== fileName) ?? ''
    citations.push({ fileName: fileName.trim(), excerpt: excerpt.trim() })
  }

  return citations
}
```

- [ ] **Step 2: Commit**

```bash
git add e2e/fixtures/getCitationsFromLastMessage.ts
git commit -m "feat(e2e): add getCitationsFromLastMessage helper"
```

---

### Task 7: `sendChatMessage`

**Files:**

- Create: `e2e/fixtures/sendChatMessage.ts`

- [ ] **Step 1: Create `e2e/fixtures/sendChatMessage.ts`**

Types text into the chat textarea (`[aria-label="Message input"]`), submits with Enter,
waits for stream to complete, then reads the last assistant message text and its citations.

**Note:** The `ChatInput.tsx` textarea must have `aria-label="Message input"` (Task 2 above).
The last assistant message text is inside the message bubble — the locator targets
`[data-testid="assistant-message"]` or the message list's last assistant entry. Look at the
rendered DOM: message bubbles are rendered inside the chat message list. Use the text content
of the last message bubble's text container.

```typescript
// e2e/fixtures/sendChatMessage.ts
import type { Page } from '@playwright/test'
import { waitForStreamComplete } from './waitForStreamComplete'
import { getCitationsFromLastMessage } from './getCitationsFromLastMessage'
import type { ParsedCitation } from './getCitationsFromLastMessage'

export interface ChatResponse {
  text: string
  citations: ParsedCitation[]
}

export async function sendChatMessage(
  page: Page,
  message: string,
  streamTimeoutMs = 30_000,
): Promise<ChatResponse> {
  const textarea = page.locator('[aria-label="Message input"]')
  await textarea.fill(message)
  await textarea.press('Enter')

  // Wait for streaming to begin (Stop button appears)
  await page.locator('[aria-label="Stop response"]').waitFor({ state: 'visible', timeout: 10_000 })

  // Wait for streaming to complete (Send button reappears)
  await waitForStreamComplete(page, streamTimeoutMs)

  // Get text of the last assistant message
  // Assistant messages are in prose containers after the user message
  const messageBubbles = page.locator('[data-role="assistant"]')
  const bubbleCount = await messageBubbles.count()
  const text = bubbleCount > 0 ? ((await messageBubbles.last().textContent()) ?? '').trim() : ''

  const citations = await getCitationsFromLastMessage(page)

  return { text, citations }
}
```

- [ ] **Step 2: Commit**

```bash
git add e2e/fixtures/sendChatMessage.ts
git commit -m "feat(e2e): add sendChatMessage helper"
```

---

## Chunk 3: Main Spec File

### Task 8: Scaffold spec + `beforeAll` + Embedding Pipeline describe

**Files:**

- Create: `e2e/ragPipeline.spec.ts`

- [ ] **Step 1: Create `e2e/ragPipeline.spec.ts` — scaffold + `beforeAll` + Embedding Pipeline**

`[data-role="assistant"]` is available because Task 2 added it to `MessageBubble.tsx`.

```typescript
// e2e/ragPipeline.spec.ts
import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './fixtures/launchApp'
import type { AppHandle } from './fixtures/launchApp'
import { TEST_DATA_ROOT } from './fixtures/testDataDir'
import { configureAISettings } from './fixtures/configureAISettings'
import { waitForEmbeddingReady } from './fixtures/waitForEmbeddingReady'
import { sendChatMessage } from './fixtures/sendChatMessage'
import { getCitationsFromLastMessage } from './fixtures/getCitationsFromLastMessage'
import type { EmbeddingStats } from '../src/shared/contracts/embedding-provider-contract'

// ─── Environment guard ──────────────────────────────────────────────────────
test.skip(
  !process.env.VOYAGE_API_KEY || !process.env.ANTHROPIC_API_KEY,
  'Skipped: set VOYAGE_API_KEY + ANTHROPIC_API_KEY to run RAG pipeline tests',
)

// ─── Shared state ────────────────────────────────────────────────────────────
let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  const { page } = handle

  // 1. Configure file server root (Settings → Connections)
  await page.click('a[href="/settings"]')
  await page.getByText('Connections').click()
  await page.waitForSelector('text=File Server', { timeout: 5_000 })
  const rootInput = page.locator('#root-path')
  await rootInput.fill('')
  await rootInput.fill(TEST_DATA_ROOT)
  await page.click('button:has-text("Save")')
  await page.waitForSelector('text=✓ Saved', { timeout: 5_000 })
  await page.waitForSelector('text=Indexing started', { timeout: 5_000 })

  // 2. Configure AI settings (Voyage + Anthropic keys, auto mode)
  await configureAISettings(page, {
    voyageApiKey: process.env.VOYAGE_API_KEY!,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
    retrievalMode: 'auto',
    useReranking: false,
  })

  // 3. Navigate to Chat and activate grounded mode with PROJ-003 scope
  await page.click('a[href="/chat"]')
  await page.waitForTimeout(500)

  // Open scope selector
  await page.click('[aria-label="Scope"]')
  await page.waitForSelector('[aria-label="Scope options"]', { timeout: 5_000 })
  await page.waitForTimeout(1_000) // let sources/projects load

  // Check all sources (grounded mode requires at least one source selected)
  const sourceCheckboxes = page
    .locator('[aria-label="Scope options"] section')
    .first()
    .locator('input[type="checkbox"]')
  const sourceCount = await sourceCheckboxes.count()
  for (let i = 0; i < sourceCount; i++) {
    const cb = sourceCheckboxes.nth(i)
    if (!(await cb.isChecked())) {
      await cb.check()
    }
  }

  // Click "Search these" to apply and close the panel
  await page.click('button:has-text("Search these")')
})

test.afterAll(async () => {
  if (handle) {
    // Reset to defaults
    await configureAISettings(handle.page, {
      retrievalMode: 'auto',
      useReranking: false,
    })
    await closeApp(handle)
  }
})

// ─── Embedding Pipeline ───────────────────────────────────────────────────────
test.describe('Embedding Pipeline @expensive', () => {
  test('indexing completes — PROJ-003 file appears in index within 15 s', async () => {
    const { page } = handle
    // Navigate to Projects and search for our fixture file
    await page.click('a[href="/projects"]')
    await expect(page.locator('[role="searchbox"]')).toBeVisible({ timeout: 5_000 })
    const searchBox = page.locator('[role="searchbox"]')
    await searchBox.fill('Riverfront_Plaza')
    await expect(page.locator('[data-testid="search-result-item"]').first()).toBeVisible({
      timeout: 15_000,
    })
  })

  test('embedding stats: hasProvider is true', async () => {
    const { page } = handle
    const stats = await page.evaluate(() =>
      (
        window as unknown as {
          kordaAPI: { getEmbeddingStats(): Promise<EmbeddingStats> }
        }
      ).kordaAPI.getEmbeddingStats(),
    )
    expect(stats.hasProvider).toBe(true)
  })

  test('all chunks reach isReady (percent = 100)', async () => {
    const { page } = handle
    const stats = await waitForEmbeddingReady(page, 90_000)
    expect(stats.isReady).toBe(true)
    expect(stats.percent).toBe(100)
    expect(stats.embedded).toBe(stats.total)
  })
})
```

- [ ] **Step 3: Commit the partial spec**

```bash
git add e2e/ragPipeline.spec.ts
git commit -m "feat(e2e): add ragPipeline spec scaffold + Embedding Pipeline describe"
```

---

### Task 9: Keyword Mode and Hybrid Mode describe blocks

**Files:**

- Modify: `e2e/ragPipeline.spec.ts`

- [ ] **Step 1: Append the `Keyword Mode` describe block**

Add after the Embedding Pipeline describe block:

```typescript
// ─── Keyword Mode ─────────────────────────────────────────────────────────────
test.describe('Keyword Mode @expensive', () => {
  test.beforeEach(async () => {
    await configureAISettings(handle.page, { retrievalMode: 'keyword' })
    await handle.page.click('a[href="/chat"]')
  })

  test('keyword query returns citation with correct N-value fact', async () => {
    const { page } = handle
    const { text, citations } = await sendChatMessage(
      page,
      'What is the SPT N-value in the fill layer?',
    )
    expect(citations.length).toBeGreaterThan(0)
    expect(citations[0].fileName).toContain('Riverfront_Plaza')
    expect(text).toMatch(/3.*8|N.?value.*fill|fill.*N.?value/i)
  })

  test('semantic query does NOT return the 120 kPa bearing capacity fact (proves vector gap)', async () => {
    const { page } = handle
    const { text, citations } = await sendChatMessage(
      page,
      'What load can the soil safely support?',
    )
    const hasStrongCitation = citations.some((c) => c.fileName.includes('Riverfront_Plaza'))
    const hasKeyFact = /120\s*kPa/i.test(text)
    // At least one must be false — BM25 alone cannot answer this semantic query
    expect(hasStrongCitation && hasKeyFact).toBe(false)
  })
})
```

- [ ] **Step 2: Append the `Hybrid Mode` describe block**

```typescript
// ─── Hybrid Mode ──────────────────────────────────────────────────────────────
test.describe('Hybrid Mode @expensive', () => {
  test.beforeEach(async () => {
    await configureAISettings(handle.page, { retrievalMode: 'auto' })
    await handle.page.click('a[href="/chat"]')
  })

  test('semantic bearing-capacity query returns 120 kPa fact', async () => {
    const { page } = handle
    const { text, citations } = await sendChatMessage(
      page,
      'What load can the soil safely support?',
    )
    expect(citations.length).toBeGreaterThan(0)
    expect(citations[0].fileName).toContain('Riverfront_Plaza')
    expect(text).toMatch(/120\s*kPa|bearing capacity.*120|120.*allowable/i)
  })

  test('semantic liquefaction query returns seismic fact', async () => {
    const { page } = handle
    const { text } = await sendChatMessage(
      page,
      'Is the site at risk of ground movement during an earthquake?',
    )
    expect(text).toMatch(/liquefaction|0\.18g|seismic amplification/i)
  })

  test('synthesis query spans both foundation and seismic sections', async () => {
    const { page } = handle
    const { text } = await sendChatMessage(page, 'Summarise the foundation options and their risks')
    expect(text).toMatch(/piles?|14\s*m/i)
    expect(text).toMatch(/120|bearing capacity/i)
  })
})
```

- [ ] **Step 3: Commit**

```bash
git add e2e/ragPipeline.spec.ts
git commit -m "feat(e2e): add Keyword Mode and Hybrid Mode describe blocks"
```

---

### Task 10: Reranking Toggle + final push

**Files:**

- Modify: `e2e/ragPipeline.spec.ts`

- [ ] **Step 1: Append the `Reranking Toggle` describe block**

```typescript
// ─── Reranking Toggle ─────────────────────────────────────────────────────────
test.describe('Reranking Toggle @expensive', () => {
  test.beforeEach(async () => {
    await configureAISettings(handle.page, { retrievalMode: 'auto', useReranking: true })
    await handle.page.click('a[href="/chat"]')
  })

  test.afterEach(async () => {
    // Reset reranking off after each test to avoid state bleed
    await configureAISettings(handle.page, { useReranking: false })
  })

  test('reranking does not break semantic retrieval — bearing capacity citation still present', async () => {
    const { page } = handle
    const { text, citations } = await sendChatMessage(
      page,
      'What load can the soil safely support?',
    )
    expect(citations.length).toBeGreaterThan(0)
    expect(citations[0].fileName).toContain('Riverfront_Plaza')
    expect(text).toMatch(/120\s*kPa|bearing capacity.*120|120.*allowable/i)
  })

  test('reranking does not break keyword retrieval — SPT N-value fact still returned', async () => {
    const { page } = handle
    const { text, citations } = await sendChatMessage(
      page,
      'What is the SPT N-value in the fill layer?',
    )
    expect(citations.length).toBeGreaterThan(0)
    expect(citations[0].fileName).toContain('Riverfront_Plaza')
    expect(text).toMatch(/3.*8|N.?value.*fill|fill.*N.?value/i)
  })
})
```

- [ ] **Step 2: Commit**

```bash
git add e2e/ragPipeline.spec.ts
git commit -m "feat(e2e): add Reranking Toggle describe block — complete ragPipeline spec"
```

- [ ] **Step 3: Push all commits to remote**

```bash
git push origin main
```

- [ ] **Step 4: Verify the full file list is in place**

```bash
ls e2e/fixtures/
ls scripts/generateRagFixture.ts
ls "src/main/__testdata__/projects/PROJ-003/"
```

Expected output:

```
configureAISettings.ts
getCitationsFromLastMessage.ts
launchApp.ts        (pre-existing)
sendChatMessage.ts
testDataDir.ts      (pre-existing)
waitForEmbeddingReady.ts
waitForStreamComplete.ts
```

```
scripts/generateRagFixture.ts
```

```
Riverfront_Plaza_Geotech_Report.pdf
```

- [ ] **Step 5: Dry-run the test guard (no keys needed)**

Remove or temporarily unset `VOYAGE_API_KEY`, then run:

```bash
npx playwright test e2e/ragPipeline.spec.ts
```

Expected: all tests skip with message `"Skipped: set VOYAGE_API_KEY + ANTHROPIC_API_KEY to run RAG pipeline tests"`.

- [ ] **Step 6: Final push (if any last changes)**

```bash
git push origin main
```
