import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './fixtures/launchApp'

const BAD_PATH = 'C:\\nonexistent\\path\\korda-xyz-does-not-exist'

test.describe('Error path', () => {
  test('bad root path → error in Connections + Unreachable in System Status', async () => {
    const { app, page } = await launchApp()

    try {
      // 1. Navigate to Settings > Connections
      await expect(page.locator('[aria-label="Module navigation"]')).toBeVisible({ timeout: 10_000 })
      await page.click('a[href="/settings"]')
      await expect(page.locator('text=Connections')).toBeVisible({ timeout: 5_000 })
      await page.click('text=Connections')
      await expect(page.locator('text=File Server')).toBeVisible({ timeout: 3_000 })

      // 2. Enter a path that does not exist
      const input = page.locator('#root-path')
      await input.fill('')
      await input.fill(BAD_PATH)

      // 3. Click Save — store write should succeed
      await page.click('button:has-text("Save")')
      await expect(page.locator('text=✓ Saved')).toBeVisible({ timeout: 5_000 })

      // 4. Wait for error text to appear in the status panel
      // The crawl is async — do NOT assert immediately; poll with waitFor
      // Status panel shows error with class="text-error" when status.status === 'error'
      await expect(
        page.locator('.text-error, .text-red-400').first()
      ).toBeVisible({ timeout: 15_000 })

      // 5. Navigate to System Status
      await page.click('a[href="/status"]')
      await expect(page.locator('h1:has-text("System Status")')).toBeVisible({ timeout: 5_000 })

      // 6. Wait for File Server row to show Unreachable
      // SystemStatusModule calls fileIndexStatus() on mount — crawl error is already in DB meta
      await expect(
        page.locator('[data-testid="file-server-status"]')
      ).toHaveText(/unreachable/i, { timeout: 8_000 })

    } finally {
      await closeApp({ app, page })
    }
  })
})
