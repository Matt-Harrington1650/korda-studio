// e2e/fixtures/waitForEmbeddingReady.ts
import type { Page } from '@playwright/test'
import type { EmbeddingStats } from '../../src/shared/contracts/embedding-provider-contract'
import type { IngestionStatus } from '../../src/shared/ipc-types'

export async function waitForEmbeddingReady(
  page: Page,
  timeoutMs = 90_000,
): Promise<EmbeddingStats> {
  const deadline = Date.now() + timeoutMs
  let lastStats: EmbeddingStats | null = null
  let lastIngestion: IngestionStatus | null = null

  while (Date.now() < deadline) {
    try {
      const [stats, ingestion] = await Promise.all([
        page.evaluate(() =>
          (
            window as unknown as { kordaAPI: { getEmbeddingStats(): Promise<EmbeddingStats> } }
          ).kordaAPI.getEmbeddingStats(),
        ),
        page.evaluate(() =>
          (
            window as unknown as { kordaAPI: { ingestionStatus(): Promise<IngestionStatus> } }
          ).kordaAPI.ingestionStatus(),
        ),
      ])
      lastStats = stats
      lastIngestion = ingestion

      if (stats.isReady) {
        return stats
      }
    } catch {
      // kordaAPI not yet exposed — retry on next tick
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 2_000))
  }

  throw new Error(
    `EmbeddingReadyTimeout: Embeddings not ready after ${timeoutMs} ms.\n` +
      `  Last embedding stats: ${JSON.stringify(lastStats)}\n` +
      `  Last ingestion status: ${JSON.stringify(lastIngestion)}\n` +
      `  Check: VOYAGE_API_KEY is set and valid, Voyage API is reachable,\n` +
      `  and no files are stuck in 'failed' state (failed > 0 means PDF extraction failed).`,
  )
}
