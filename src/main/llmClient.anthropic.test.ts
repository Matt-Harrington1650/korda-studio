// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAnthropic, mockMessagesCreate, mockMessagesStream, mockToolRegistry } = vi.hoisted(
  () => {
    const hoistedMessagesCreate = vi.fn()
    const hoistedMessagesStream = vi.fn()
    const hoistedAnthropic = vi.fn(
      class {
        messages = {
          create: hoistedMessagesCreate,
          stream: hoistedMessagesStream,
        }
      },
    )
    const hoistedToolRegistry = {
      execute: vi.fn(),
      getSchemas: vi.fn(),
    }

    return {
      mockAnthropic: hoistedAnthropic,
      mockMessagesCreate: hoistedMessagesCreate,
      mockMessagesStream: hoistedMessagesStream,
      mockToolRegistry: hoistedToolRegistry,
    }
  },
)

vi.mock('@anthropic-ai/sdk', () => ({
  default: mockAnthropic,
}))

vi.mock('./toolRegistry', () => ({
  toolRegistry: mockToolRegistry,
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
    mockToolRegistry.getSchemas.mockReturnValue([])
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

  it('runs a multi-turn tool loop and batches tool results into one user turn', async () => {
    mockToolRegistry.getSchemas.mockReturnValue([
      {
        name: 'search_knowledge_base',
        description: 'Search docs',
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      },
    ])
    mockToolRegistry.execute
      .mockResolvedValueOnce({ content: { matches: ['beam-a'] } })
      .mockResolvedValueOnce({ content: { matches: ['beam-b'] } })
    mockMessagesCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'search_knowledge_base',
            input: { query: 'beam loads' },
          },
          {
            type: 'tool_use',
            id: 'toolu_2',
            name: 'search_knowledge_base',
            input: { query: 'corridor loads' },
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Done' }],
      })

    const controller = new AbortController()
    const onToolCall = vi.fn()
    const client = new AnthropicClient(() => 'test-key')

    await (
      client as unknown as {
        runToolLoop: (
          messages: Array<{ role: 'user' | 'assistant'; content: string }>,
          model: string,
          systemPrompt: string,
          onToolCall: (name: string, input: Record<string, unknown>) => void,
          maxToolCalls?: number,
          signal?: AbortSignal,
        ) => Promise<void>
      }
    ).runToolLoop(
      [{ role: 'user', content: 'Find beam criteria' }],
      'claude-haiku-4-5',
      'Search system',
      onToolCall,
      4,
      controller.signal,
    )

    expect(mockMessagesCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        max_tokens: 1024,
        model: 'claude-haiku-4-5',
        system: 'Search system',
        tool_choice: { type: 'any' },
        tools: mockToolRegistry.getSchemas(),
        messages: [{ role: 'user', content: 'Find beam criteria' }],
      }),
      { signal: controller.signal },
    )
    expect(mockToolRegistry.execute).toHaveBeenNthCalledWith(1, 'search_knowledge_base', {
      query: 'beam loads',
    })
    expect(mockToolRegistry.execute).toHaveBeenNthCalledWith(2, 'search_knowledge_base', {
      query: 'corridor loads',
    })
    expect(onToolCall).toHaveBeenNthCalledWith(1, 'search_knowledge_base', { query: 'beam loads' })
    expect(onToolCall).toHaveBeenNthCalledWith(2, 'search_knowledge_base', {
      query: 'corridor loads',
    })
    expect(mockMessagesCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messages: [
          { role: 'user', content: 'Find beam criteria' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_1',
                name: 'search_knowledge_base',
                input: { query: 'beam loads' },
              },
              {
                type: 'tool_use',
                id: 'toolu_2',
                name: 'search_knowledge_base',
                input: { query: 'corridor loads' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'toolu_1',
                content: JSON.stringify({ matches: ['beam-a'] }),
              },
              {
                type: 'tool_result',
                tool_use_id: 'toolu_2',
                content: JSON.stringify({ matches: ['beam-b'] }),
              },
            ],
          },
        ],
      }),
      { signal: controller.signal },
    )
  })

  it('stops the tool loop when maxToolCalls is reached', async () => {
    mockMessagesCreate.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'search_knowledge_base',
          input: { query: 'beam loads' },
        },
      ],
    })
    mockToolRegistry.execute.mockResolvedValue({ content: { matches: ['beam-a'] } })

    const client = new AnthropicClient(() => 'test-key')
    await (
      client as unknown as {
        runToolLoop: (
          messages: Array<{ role: 'user' | 'assistant'; content: string }>,
          model: string,
          systemPrompt: string,
          onToolCall: (name: string, input: Record<string, unknown>) => void,
          maxToolCalls?: number,
        ) => Promise<void>
      }
    ).runToolLoop(
      [{ role: 'user', content: 'Find beam criteria' }],
      'claude-haiku-4-5',
      'Search system',
      vi.fn(),
      1,
    )

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1)
  })

  it('returns a non-throwing streamWithTools stub for Phase 3B', async () => {
    const client = new AnthropicClient(() => 'test-key')
    mockMessagesCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Done' }],
    })

    const result = (
      client as unknown as {
        streamWithTools: (
          messages: Array<{ role: 'user' | 'assistant'; content: string }>,
          tools: unknown[],
          model: string,
          systemPrompt: string,
        ) => {
          iterable: AsyncIterable<string>
          abort(): void
          finalMessage(): Promise<{ inputTokens: number; outputTokens: number }>
          onToolCall(
            cb: (call: {
              id: string
              name: string
              input: Record<string, unknown>
            }) => Promise<unknown>,
          ): void
        }
      }
    ).streamWithTools([], [], 'claude-sonnet-4-6', 'System')

    result.onToolCall(async () => undefined)
    await expect(result.finalMessage()).resolves.toEqual({
      inputTokens: 0,
      outputTokens: 0,
    })
  })
})
