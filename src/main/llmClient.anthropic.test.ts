// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAnthropic, mockMessagesStream } = vi.hoisted(() => {
  const hoistedMessagesStream = vi.fn()
  const hoistedAnthropic = vi.fn(
    class {
      messages = {
        stream: hoistedMessagesStream,
      }
    },
  )

  return {
    mockAnthropic: hoistedAnthropic,
    mockMessagesStream: hoistedMessagesStream,
  }
})

vi.mock('@anthropic-ai/sdk', () => ({
  default: mockAnthropic,
}))

import { AnthropicClient } from './llmClient'

function createMockStream(events: unknown[], usage = { input_tokens: 11, output_tokens: 22 }) {
  return {
    abort: vi.fn(),
    finalMessage: vi.fn().mockResolvedValue({ usage }),
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event
      }
    },
  }
}

describe('AnthropicClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('formats messages with system as a top-level param', () => {
    const stream = createMockStream([])
    mockMessagesStream.mockReturnValue(stream)

    const client = new AnthropicClient(() => 'test-key')
    client.stream([{ role: 'user', content: 'Hello Claude' }], 'claude-sonnet-4-6', 'Be helpful')

    expect(mockAnthropic).toHaveBeenCalledWith({ apiKey: 'test-key' })
    expect(mockMessagesStream).toHaveBeenCalledWith({
      max_tokens: 8096,
      messages: [{ role: 'user', content: 'Hello Claude' }],
      model: 'claude-sonnet-4-6',
      system: 'Be helpful',
    })
  })

  it('yields text delta chunks in order', async () => {
    mockMessagesStream.mockReturnValue(
      createMockStream([
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello' },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{"ignored":true}' },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: ' world' },
        },
      ]),
    )

    const client = new AnthropicClient(() => 'test-key')
    const result = client.stream([{ role: 'user', content: 'Hi' }], 'claude-sonnet-4-6', 'System')

    const chunks: string[] = []
    for await (const chunk of result.iterable) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(['Hello', ' world'])
  })

  it('aborts the underlying MessageStream', () => {
    const stream = createMockStream([])
    mockMessagesStream.mockReturnValue(stream)

    const client = new AnthropicClient(() => 'test-key')
    const result = client.stream([{ role: 'user', content: 'Hi' }], 'claude-sonnet-4-6', 'System')

    result.abort()

    expect(stream.abort).toHaveBeenCalled()
  })

  it('extracts token usage from finalMessage', async () => {
    mockMessagesStream.mockReturnValue(
      createMockStream([], { input_tokens: 123, output_tokens: 456 }),
    )

    const client = new AnthropicClient(() => 'test-key')
    const result = client.stream([{ role: 'user', content: 'Hi' }], 'claude-sonnet-4-6', 'System')

    await expect(result.finalMessage()).resolves.toEqual({
      inputTokens: 123,
      outputTokens: 456,
    })
  })
})
