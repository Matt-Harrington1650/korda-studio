// e2e/fixtures/waitForEmbeddingReady.ts
import type { Page } from '@playwright/test'
import type { EmbeddingStats } from '../../src/shared/contracts/embedding-provider-contract'

export async function waitForEmbeddingReady(
  page: Page,
  timeoutMs = 90_000,
): Promise<EmbeddingStats> {
  const deadline = Date.now() + timeoutMs
  let lastStats: EmbeddingStats | null = null

  while (Date.now() < deadline) {
    const stats = await page.evaluate(() =>
      (
        window as unknown as { kordaAPI: { getEmbeddingStats(): Promise<EmbeddingStats> } }
      ).kordaAPI.getEmbeddingStats(),
    )
    lastStats = stats

    if (stats.isReady) {
      return stats
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 2_000))
  }

  throw new Error(
    `EmbeddingReadyTimeout: Embeddings not ready after ${timeoutMs} ms.\n` +
      `  Last stats: ${JSON.stringify(lastStats)}\n` +
      `  Check: VOYAGE_API_KEY is set and valid, Voyage API is reachable`,
  )
}
