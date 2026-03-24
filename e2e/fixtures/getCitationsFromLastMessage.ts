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
