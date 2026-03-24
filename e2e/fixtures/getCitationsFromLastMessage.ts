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

  // The citation panel root is the direct parent of the toggle button
  const panel = lastToggle.locator('..')
  const rows = panel.locator('.rounded-xl.border.border-border.bg-surface-raised\\/60')

  // Expand if not already open
  if (ariaLabel === 'Show sources') {
    await lastToggle.click()
    // Wait for the first citation row to appear (condition-based, not a fixed sleep)
    await rows.first().waitFor({ state: 'visible', timeout: 5_000 })
  }

  const rowCount = await rows.count()

  const citations: ParsedCitation[] = []
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i)
    // fileName is in the .truncate div
    const fileName = (await row.locator('.truncate').textContent()) ?? ''
    // excerpt uses the mt-2 variant of text-sm text-text-primary (distinct from the fileName div)
    const excerpt = (await row.locator('.mt-2.text-sm.text-text-primary').textContent()) ?? ''
    citations.push({ fileName: fileName.trim(), excerpt: excerpt.trim() })
  }

  return citations
}
