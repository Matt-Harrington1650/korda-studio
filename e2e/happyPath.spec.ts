import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './fixtures/launchApp'
import { TEST_DATA_ROOT } from './fixtures/testDataDir'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

test.describe('Happy path', () => {
  test('launch → configure → index → search → open', async () => {
    const { app, page } = await launchApp()

    try {
      // Check if the DB file exists
      const electronUserData = path.join(os.homedir(), 'AppData', 'Roaming', 'Electron')
      const dbPath = path.join(electronUserData, 'file-index.db')
      console.log('DB path:', dbPath, 'exists:', fs.existsSync(dbPath))

      // 1. Shell is visible
      await expect(page.locator('[aria-label="Module navigation"]')).toBeVisible({ timeout: 10_000 })

      // Check DB again after app fully loaded
      console.log('DB after load:', fs.existsSync(dbPath))

      // Check index status
      const statusBefore = await page.evaluate(async () => {
        return await (window as any).kordaAPI.fileIndexStatus()
      })
      console.log('Status before nav:', JSON.stringify(statusBefore))

      // 2. Navigate to Settings via sidebar link
      await page.click('a[href="/settings"]')

      // 3. Click Connections nav item
      await expect(page.locator('text=Connections')).toBeVisible({ timeout: 5_000 })
      await page.click('text=Connections')
      await expect(page.locator('text=File Server')).toBeVisible({ timeout: 3_000 })

      // 4. Enter the test data root path
      const input = page.locator('#root-path')
      await input.fill('')
      await input.fill(TEST_DATA_ROOT)

      // 5. Click Save
      await page.click('button:has-text("Save")')

      // 6. Assert success banner
      await expect(page.locator('text=Saved')).toBeVisible({ timeout: 5_000 })

      // 7. Wait for crawl to complete
      await page.waitForTimeout(3_000)
      console.log('DB after save:', fs.existsSync(dbPath))

      // Check status after save
      const statusAfterSave = await page.evaluate(async () => {
        return await (window as any).kordaAPI.fileIndexStatus()
      })
      console.log('Status after save:', JSON.stringify(statusAfterSave))

      // 8. Navigate to Projects
      await page.click('a[href="/projects"]')
      await expect(page.locator('[role="searchbox"]')).toBeVisible({ timeout: 5_000 })

      // 9. Search for C-101
      const searchBox = page.locator('[role="searchbox"]')
      await searchBox.click()
      await searchBox.fill('C-101')
      await page.waitForTimeout(500)

      // 10. Wait for results
      const firstResult = page.locator('[data-testid="search-result-item"]').first()
      await expect(firstResult).toBeVisible({ timeout: 10_000 })

      // 11. Assert drawing number badge
      await expect(page.locator('[data-testid="search-result-item"] >> text=C-101').first()).toBeVisible()

      // 12. Inject shell.openPath spy
      await app.evaluate(({ shell }) => {
        ;(shell as any).__lastOpenedPath = null
        const orig = shell.openPath
        ;(shell as any).__origOpenPath = orig
        shell.openPath = async (p: string) => {
          ;(shell as any).__lastOpenedPath = p
          return ''
        }
      })

      // 13. Click the first result
      await firstResult.click()

      // 14. Verify shell.openPath was called
      await page.waitForTimeout(500)
      const openedPath = await app.evaluate(({ shell }) => (shell as any).__lastOpenedPath as string | null)
      expect(openedPath).toBeTruthy()
      expect(openedPath!).toContain('C-101_IFC_Rev_A.dwg')

      // 15. Restore
      await app.evaluate(({ shell }) => {
        shell.openPath = (shell as any).__origOpenPath
      })

    } finally {
      await closeApp({ app, page })
    }
  })
})
