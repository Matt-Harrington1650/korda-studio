// e2e/ragPipeline.spec.ts
import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './fixtures/launchApp'
import type { AppHandle } from './fixtures/launchApp'
import { TEST_DATA_ROOT } from './fixtures/testDataDir'
import { configureAISettings } from './fixtures/configureAISettings'
import { waitForEmbeddingReady } from './fixtures/waitForEmbeddingReady'
import { sendChatMessage as _sendChatMessage } from './fixtures/sendChatMessage'
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
