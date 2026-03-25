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

// ─── Shared state ────────────────────────────────────────────────────────────
let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  const { page } = handle

  // Wait for the renderer to be fully ready before navigating
  await page.waitForSelector('a[href="/settings"]', { timeout: 10_000 })

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
  // Navigate to Chat and wait for scope button to be ready
  await page.click('a[href="/chat"]')
  await page.waitForSelector('[aria-label="Scope"]', { timeout: 10_000 })

  // Open scope selector
  await page.click('[aria-label="Scope"]')
  await page.waitForSelector('[aria-label="Scope options"]', { timeout: 5_000 })
  // Wait for at least one source checkbox to appear before checking
  await page.waitForSelector('[aria-label="Scope options"] section input[type="checkbox"]', {
    timeout: 10_000,
  })

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
  test.beforeEach(async () => {
    await configureAISettings(handle.page, { retrievalMode: 'keyword' })
    await handle.page.click('a[href="/chat"]')
    await handle.page.waitForSelector('[aria-label="Message input"]', { timeout: 10_000 })
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

// ─── Hybrid Mode ──────────────────────────────────────────────────────────────
test.describe('Hybrid Mode @expensive', () => {
  test.beforeEach(async () => {
    await configureAISettings(handle.page, { retrievalMode: 'auto' })
    await handle.page.click('a[href="/chat"]')
    await handle.page.waitForSelector('[aria-label="Message input"]', { timeout: 10_000 })
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
    expect(text).toMatch(/120\s*kPa|bearing capacity/i)
  })
})

// ─── Reranking Toggle ─────────────────────────────────────────────────────────
test.describe('Reranking Toggle @expensive', () => {
  test.beforeEach(async () => {
    await configureAISettings(handle.page, { retrievalMode: 'auto', useReranking: true })
    await handle.page.click('a[href="/chat"]')
    await handle.page.waitForSelector('[aria-label="Message input"]', { timeout: 10_000 })
  })

  test.afterEach(async () => {
    // Reset reranking off after each test to avoid state bleed
    // Wrapped in try/catch so cleanup errors don't fail a passing test
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
