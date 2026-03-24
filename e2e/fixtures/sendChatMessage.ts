// e2e/fixtures/sendChatMessage.ts
import type { Page } from '@playwright/test'
import { waitForStreamComplete } from './waitForStreamComplete'
import { getCitationsFromLastMessage } from './getCitationsFromLastMessage'
import type { ParsedCitation } from './getCitationsFromLastMessage'

export interface ChatResponse {
  text: string
  citations: ParsedCitation[]
}

export async function sendChatMessage(
  page: Page,
  message: string,
  streamTimeoutMs = 30_000,
): Promise<ChatResponse> {
  const textarea = page.locator('[aria-label="Message input"]')
  await textarea.fill(message)
  await textarea.press('Enter')

  // Wait for streaming to begin (Stop button appears)
  await page.locator('[aria-label="Stop response"]').waitFor({ state: 'visible', timeout: 10_000 })

  // Wait for streaming to complete (Send button reappears)
  await waitForStreamComplete(page, streamTimeoutMs)

  // Get text of the last assistant message
  // Assistant messages are in prose containers after the user message
  const messageBubbles = page.locator('[data-role="assistant"]')
  const bubbleCount = await messageBubbles.count()
  const text = bubbleCount > 0 ? ((await messageBubbles.last().textContent()) ?? '').trim() : ''

  const citations = await getCitationsFromLastMessage(page)

  return { text, citations }
}
