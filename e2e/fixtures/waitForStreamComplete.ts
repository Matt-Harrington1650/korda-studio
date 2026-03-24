import type { Page } from '@playwright/test'

export async function waitForStreamComplete(page: Page, timeoutMs = 30_000): Promise<void> {
  await page
    .locator('[aria-label="Send message"]')
    .waitFor({ state: 'visible', timeout: timeoutMs })
}
