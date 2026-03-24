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
