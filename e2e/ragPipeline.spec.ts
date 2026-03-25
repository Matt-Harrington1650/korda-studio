// e2e/ragPipeline.spec.ts
import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './fixtures/launchApp'
import type { AppHandle } from './fixtures/launchApp'
import { TEST_DATA_ROOT } from './fixtures/testDataDir'
import { configureAISettings } from './fixtures/configureAISettings'
import { waitForEmbeddingReady } from './fixtures/waitForEmbeddingReady'
import { sendChatMessage } from './fixtures/sendChatMessage'
import { getCitationsFromLastMessage as _getCitationsFromLastMessage } from './fixtures/getCitationsFromLastMessage'
import type { EmbeddingStats } from '../src/shared/contracts/embedding-provider-contract'

// ─── Environment guard ──────────────────────────────────────────────────────
test.skip(
  !process.env.VOYAGE_API_KEY || !process.env.ANTHROPIC_API_KEY,
  'Skipped: set VOYAGE_API_KEY + ANTHROPIC_API_KEY to run RAG pipeline tests',
)

// Extend timeout for all tests and hooks in this file — Electron cold start
// takes well over 10 s and beforeAll/afterAll would otherwise hit the 30 s config limit.
// 300 s covers the full beforeAll: app launch (60 s) + ingestion wait (≤90 s) + setup.
// Describe blocks override this per-test with their own test.setTimeout(120_000).
test.setTimeout(300_000)

// ─── Shared state ────────────────────────────────────────────────────────────
let handle: AppHandle

// ─── Chat helpers ─────────────────────────────────────────────────────────────
// ChatModule stores selectedSourceIds in React state — it resets to [] every
// time the component unmounts (i.e. whenever we navigate away from /chat).
// Call this before every test that uses sendChatMessage to ensure grounded mode
// is active with all available sources.
async function navigateToChatWithScope(): Promise<void> {
  const { page } = handle
  await page.click('a[href="/chat"]')
  // Start a fresh conversation so prior test messages don't pollute the context
  await page.waitForSelector('button:has-text("New Chat")', { timeout: 10_000 })
  await page.click('button:has-text("New Chat")')
  await page.waitForSelector('[aria-label="Message input"]', { timeout: 10_000 })

  // Scope resets on every ChatModule mount — re-select all sources each time
  await page.click('[aria-label="Scope"]')
  await page.waitForSelector('[aria-label="Scope options"]', { timeout: 5_000 })
  await page.waitForSelector('[aria-label="Scope options"] section input[type="checkbox"]', {
    timeout: 10_000,
  })
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
  await page.click('button:has-text("Search these")')
}

test.beforeAll(async () => {
  handle = await launchApp()
  const { page } = handle

  // Wait for the sidebar nav to mount — this is the correct ready signal used
  // by the existing happyPath.spec.ts tests. The sidebar renders as soon as
  // the Shell component mounts, before any module lazy-loads complete.
  await page.waitForSelector('[aria-label="Module navigation"]', { timeout: 60_000 })

  // 1. Configure file server root (Settings → Connections)
  await page.click('a[href="/settings"]')
  await page.getByText('Connections').click()
  await page.waitForSelector('button:has-text("+ Add Source")', { timeout: 5_000 })

  // IPC types for this setup block
  interface SourceEntry {
    id: string
    path: string
  }
  interface IngestionStatusEntry {
    new: number
    queued: number
    extracting: number
    chunking: number
    contextualizing: number
    indexed: number
    failed: number
  }
  type KordaWindow = {
    kordaAPI: {
      fileIndexSourcesList(): Promise<SourceEntry[]>
      fileIndexReindex(id?: string): Promise<void>
      fileIndexSourceDelete(id: string): Promise<string | null>
      ingestionRetry(sourceId?: string): Promise<void>
      ingestionStatus(sourceId?: string): Promise<IngestionStatusEntry>
    }
  }

  const getSources = (): Promise<SourceEntry[]> =>
    page.evaluate(() => (window as unknown as KordaWindow).kordaAPI.fileIndexSourcesList())

  const sourcesNow = await getSources()
  const matchingSources = sourcesNow.filter((s) => s.path === TEST_DATA_ROOT)

  // Delete duplicate sources (accumulated from previous test runs) — keeping at most one.
  // deleteSourceData removes their chunks/files so old data doesn't pollute getEmbeddingStats().
  // Retry up to 3× in case a source is mid-crawl when we try to delete it.
  for (const dup of matchingSources.slice(1)) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const err = await page.evaluate(
        (id) => (window as unknown as KordaWindow).kordaAPI.fileIndexSourceDelete(id),
        dup.id,
      )
      if (!err) break
      await page.waitForTimeout(2_000)
    }
  }

  // Add the source if none exists yet
  if (matchingSources.length === 0) {
    await page.click('button:has-text("+ Add Source")')
    await page.getByPlaceholder('Main Server').fill('Test Data')
    await page.locator('input[placeholder*="SERVER"]').fill(TEST_DATA_ROOT)
    await page.click('button:has-text("Save")')
    await page.waitForSelector('text=Source saved', { timeout: 5_000 })
  }

  // Get the single remaining source
  const sourcesAfter = await getSources()
  const targetSource = sourcesAfter.find((s) => s.path === TEST_DATA_ROOT)

  if (targetSource) {
    // Full reindex: wipe stale chunks/files and re-crawl.
    // fileIndexReindex is fire-and-forget on the main process side, so we must
    // explicitly wait for ingestion to complete before proceeding to chat tests.
    // Without this wait, getEmbeddingStats() (used in test 3) can satisfy
    // itself on old embedded chunks while new uuid-source chunks are still
    // being ingested — causing tests 4+ to see citations=0.
    await page.evaluate(
      (id) => (window as unknown as KordaWindow).kordaAPI.fileIndexReindex(id),
      targetSource.id,
    )

    // Poll until this source's files are fully ingested (no pending pipeline states).
    // We poll from the test runner (not inside page.evaluate) to avoid hitting
    // Playwright's page.evaluate timeout on slow ingestion runs.
    const ingestionDeadline = Date.now() + 90_000
    while (Date.now() < ingestionDeadline) {
      await page.evaluate(
        (id) => (window as unknown as KordaWindow).kordaAPI.ingestionRetry(id),
        targetSource.id,
      )
      const status = await page.evaluate(
        (id) => (window as unknown as KordaWindow).kordaAPI.ingestionStatus(id),
        targetSource.id,
      )
      const pending =
        status.new + status.queued + status.extracting + status.chunking + status.contextualizing
      if (pending === 0 && status.indexed > 0) break
      await page.waitForTimeout(2_000)
    }
  }

  // 2. Configure AI settings via IPC (no page navigation — keeps us on
  //    Connections so we can navigate to Chat in step 3 with scope intact).
  //    Anthropic key is from env var; only Voyage needs to be set here.
  await configureAISettings(page, {
    voyageApiKey: process.env.VOYAGE_API_KEY!,
    retrievalMode: 'auto',
    useReranking: false,
  })

  // 3. Navigate to Chat and activate grounded mode (all available sources)
  await navigateToChatWithScope()
})

test.afterAll(async () => {
  if (handle) {
    try {
      // Reset to defaults
      await configureAISettings(handle.page, {
        retrievalMode: 'auto',
        useReranking: false,
      })
    } catch {
      // Cleanup errors should not mask the original test failure
    }
    await closeApp(handle)
  }
})

// ─── Embedding Pipeline ───────────────────────────────────────────────────────
test.describe('Embedding Pipeline @expensive', () => {
  test.setTimeout(120_000)

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
    await expect
      .poll(
        async () => {
          const stats = await page.evaluate(() =>
            (
              window as unknown as {
                kordaAPI: { getEmbeddingStats(): Promise<EmbeddingStats> }
              }
            ).kordaAPI.getEmbeddingStats(),
          )
          return stats.hasProvider
        },
        { timeout: 10_000 },
      )
      .toBe(true)
  })

  test('all chunks reach isReady (percent = 100)', async () => {
    const { page } = handle
    const stats = await waitForEmbeddingReady(page, 90_000)
    expect(stats.isReady).toBe(true)
    expect(stats.percent).toBe(100)
    expect(stats.embedded).toBe(stats.total)
  })
})

// ─── Keyword Mode ─────────────────────────────────────────────────────────────
test.describe('Keyword Mode @expensive', () => {
  // configureAISettings now uses storeSet IPC — no page navigation, so the
  // chat scope (grounded sources) set in beforeAll is preserved.
  test.setTimeout(120_000)

  test.beforeEach(async () => {
    await configureAISettings(handle.page, { retrievalMode: 'keyword' })
    await navigateToChatWithScope()
  })

  test('keyword query returns citation with correct N-value fact', async () => {
    const { page } = handle
    const { text, citations } = await sendChatMessage(
      page,
      'What is the SPT N-value in the fill layer?',
      60_000,
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
      60_000,
    )
    const hasStrongCitation = citations.some((c) => c.fileName.includes('Riverfront_Plaza'))
    const hasKeyFact = /120\s*kPa/i.test(text)
    // At least one must be false — BM25 alone cannot answer this semantic query
    expect(hasStrongCitation && hasKeyFact).toBe(false)
  })
})

// ─── Hybrid Mode ──────────────────────────────────────────────────────────────
test.describe('Hybrid Mode @expensive', () => {
  test.setTimeout(120_000)

  test.beforeEach(async () => {
    await configureAISettings(handle.page, { retrievalMode: 'auto' })
    await navigateToChatWithScope()
  })

  test('semantic bearing-capacity query returns 120 kPa fact', async () => {
    const { page } = handle
    const { text, citations } = await sendChatMessage(
      page,
      'What load can the soil safely support?',
      60_000,
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
      60_000,
    )
    expect(text).toMatch(/liquefaction|0\.18g|seismic amplification/i)
  })

  test('synthesis query spans both foundation and seismic sections', async () => {
    const { page } = handle
    const { text } = await sendChatMessage(
      page,
      'Summarise the foundation options and their risks',
      60_000,
    )
    expect(text).toMatch(/piles?|14\s*m/i)
    expect(text).toMatch(/120\s*kPa|bearing capacity/i)
  })
})

// ─── Reranking Toggle ─────────────────────────────────────────────────────────
test.describe('Reranking Toggle @expensive', () => {
  test.setTimeout(120_000)

  test.beforeEach(async () => {
    await configureAISettings(handle.page, { retrievalMode: 'auto', useReranking: true })
    await navigateToChatWithScope()
  })

  test.afterEach(async () => {
    // Reset reranking off after each test to avoid state bleed
    try {
      await configureAISettings(handle.page, { useReranking: false, retrievalMode: 'auto' })
    } catch {
      // Cleanup failure should not mask the test result
    }
  })

  test('reranking does not break semantic retrieval — bearing capacity citation still present', async () => {
    const { page } = handle
    const { text, citations } = await sendChatMessage(
      page,
      'What load can the soil safely support?',
      60_000,
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
      60_000,
    )
    expect(citations.length).toBeGreaterThan(0)
    expect(citations[0].fileName).toContain('Riverfront_Plaza')
    expect(text).toMatch(/3.*8|N.?value.*fill|fill.*N.?value/i)
  })
})
