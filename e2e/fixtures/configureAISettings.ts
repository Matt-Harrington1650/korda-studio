import type { Page } from '@playwright/test'

export interface AITestSettings {
  voyageApiKey?: string
  anthropicApiKey?: string
  retrievalMode?: 'keyword' | 'hybrid' | 'auto'
  useReranking?: boolean
}

type StoreAPI = {
  storeGet<T>(key: string): Promise<T | null>
  storeSet(key: string, value: unknown): Promise<void>
}
type Win = { kordaAPI: StoreAPI }

/**
 * Patches AI settings via electron-store IPC without navigating away from the
 * current page.  This is critical for chat tests: navigating to /settings/ai
 * unmounts ChatModule which resets the grounded-mode scope to empty.
 */
export async function configureAISettings(page: Page, settings: AITestSettings): Promise<void> {
  const current = await page.evaluate(() =>
    (window as unknown as Win).kordaAPI.storeGet<Record<string, unknown>>('ai'),
  )

  const next: Record<string, unknown> = { ...(current ?? {}) }
  if (settings.voyageApiKey !== undefined) next.voyageApiKey = settings.voyageApiKey
  if (settings.anthropicApiKey !== undefined) next.anthropicApiKey = settings.anthropicApiKey
  if (settings.retrievalMode !== undefined) next.retrievalMode = settings.retrievalMode
  if (settings.useReranking !== undefined) next.useReranking = settings.useReranking

  await page.evaluate((config) => (window as unknown as Win).kordaAPI.storeSet('ai', config), next)
}
