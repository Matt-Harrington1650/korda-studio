// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { RetrievalResult } from '../shared/contracts/retrieval-contract'
import { IPC_CHANNELS } from '../shared/ipc-types'

const {
  mockMessagesCreate,
  mockMessagesStream,
  mockRunToolLoop,
  mockCollectResults,
  mockReset,
  mockSetScope,
  mockSetRetrievalMode,
} = vi.hoisted(() => ({
  mockMessagesCreate: vi.fn(),
  mockMessagesStream: vi.fn(),
  mockRunToolLoop: vi.fn(),
  mockCollectResults: vi.fn(),
  mockReset: vi.fn(),
  mockSetScope: vi.fn(),
  mockSetRetrievalMode: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(
    class {
      messages = {
        create: mockMessagesCreate,
        stream: mockMessagesStream,
      }
    },
  ),
}))

vi.mock('./llmClient', () => ({
  AnthropicClient: vi.fn(
    class {
      runToolLoop = mockRunToolLoop
    },
  ),
}))

vi.mock('./toolRegistry', () => ({
  toolRegistry: {
    reset: mockReset,
    setScope: mockSetScope,
    collectResults: mockCollectResults,
    setRetrievalMode: mockSetRetrievalMode,
  },
}))

import { rewriteQuery, runGroundedPipeline } from './groundedChatService'

function makeResult(id: string, score = 1): RetrievalResult {
  return {
    chunk: {
      id,
      fileId: 1,
      sourceId: 'src1',
      chunkIndex: 0,
      text: `chunk text ${id}`,
      tokenCount: 10,
      charCount: 50,
      pageNumber: 1,
      sectionTitle: 'Section A',
      sheetName: null,
      embedding: null,
      createdAt: Date.now(),
    },
    file: {
      path: `/docs/${id}.pdf`,
      name: `${id}.pdf`,
      ext: '.pdf',
      sizeBytes: 1000,
      modifiedMs: Date.now(),
      isDir: false,
      sourceId: 'src1',
      project: 'HospitalExpansion',
      discipline: null,
      docType: null,
      drawingNumber: null,
      revision: null,
      issueStatus: null,
    },
    bm25Score: score,
    vectorDistance: null,
    rrfScore: null,
    highlight: `hl ${id}`,
  }
}

function makeMockWin() {
  const send = vi.fn()
  return { webContents: { send } } as unknown as BrowserWindow
}

const baseParams = {
  conversationId: 'conv-1',
  userContent: 'What is the fire rating for the corridor?',
  model: 'claude-sonnet-4-6',
  scopeSourceIds: ['src1'],
  projectFilters: [],
  assistantMessageId: 'asst-1',
  conversationMessages: [{ role: 'user' as const, content: 'What is the fire rating?' }],
  getApiKey: () => 'test-key',
  getAIConfig: () => ({
    provider: 'anthropic' as const,
    defaultModel: 'claude-sonnet-4-6',
    firmContext: 'Engineering firm',
  }),
  getPreferences: () => ({ firmName: 'TestFirm', disciplines: 'Structural' }),
}

describe('rewriteQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns parsed queries from the Haiku response', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '["fire rating corridor","IBC corridor requirements"]' }],
    })

    const result = await rewriteQuery('corridor fire rating', 'test-key')

    expect(result).toEqual(['fire rating corridor', 'IBC corridor requirements'])
  })

  it('falls back to the original question on parse error', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'not json' }],
    })

    const result = await rewriteQuery('my question', 'test-key')

    expect(result).toEqual(['my question'])
  })

  it('falls back to the original question on API error', async () => {
    mockMessagesCreate.mockRejectedValue(new Error('rate limit'))

    const result = await rewriteQuery('my question', 'test-key')

    expect(result).toEqual(['my question'])
  })
})

describe('runGroundedPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunToolLoop.mockResolvedValue(undefined)
  })

  it('gracefully falls back when retrieval finds no chunks', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '["fire rating corridor"]' }],
    })
    mockCollectResults.mockReturnValue([])
    mockMessagesStream.mockReturnValue({
      abort: vi.fn(),
      finalMessage: vi.fn().mockResolvedValue({
        usage: { input_tokens: 5, output_tokens: 10 },
      }),
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'fallback answer' },
        }
      },
    })

    const win = makeMockWin()
    const result = await runGroundedPipeline({ ...baseParams, win })

    expect(mockReset).toHaveBeenCalled()
    expect(mockSetScope).toHaveBeenCalledWith({ sourceIds: ['src1'], projects: [] })
    expect(mockRunToolLoop).toHaveBeenCalled()
    expect(result.mode).toBe('grounded_fallback')
    expect(result.content).toBe('fallback answer')
    expect(result.evidenceStatus).toBe('unsupported')

    const tokenCalls = (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([channel]) => channel === IPC_CHANNELS.CHAT_TOKEN,
    )
    expect(tokenCalls[0][1]).toMatch(/No matching documents found in selected scope/)
    expect(tokenCalls[1][1]).toBe('fallback answer')
  })

  it('streams citations, strips the evidence marker, and returns grounded metadata', async () => {
    const results = [makeResult('chunk-a', 2), makeResult('chunk-b', 1)]
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '["fire rating corridor"]' }],
    })
    mockCollectResults.mockReturnValue(results)
    mockMessagesStream.mockReturnValue({
      abort: vi.fn(),
      finalMessage: vi.fn().mockResolvedValue({
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'The corridor requires ' },
        }
        yield {
          type: 'content_block_delta',
          delta: {
            type: 'citations_delta',
            citation: {
              type: 'char_location',
              document_index: 0,
              cited_text: 'corridor assemblies shall achieve 2 hours',
              start_char_index: 0,
              end_char_index: 40,
            },
          },
        }
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: '2 hours.\n<!--evidence:supported-->' },
        }
      },
    })

    const win = makeMockWin()
    const result = await runGroundedPipeline({ ...baseParams, win })

    expect(result.mode).toBe('grounded')
    expect(result.evidenceStatus).toBe('supported')
    expect(result.content).toBe('The corridor requires 2 hours.')
    expect(result.citations).toHaveLength(1)
    expect(result.citations[0].excerpt).toBe('corridor assemblies shall achieve 2 hours')
    expect(result.chunkCount).toBe(2)
    expect(result.inputTokens).toBe(100)
    expect(result.outputTokens).toBe(50)

    expect(mockMessagesStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: [
          expect.objectContaining({
            type: 'text',
            cache_control: { type: 'ephemeral' },
          }),
        ],
        messages: [
          {
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'document',
                source: expect.objectContaining({
                  type: 'text',
                  media_type: 'text/plain',
                }),
                cache_control: { type: 'ephemeral' },
                citations: { enabled: true },
              }),
              { type: 'text', text: 'What is the fire rating for the corridor?' },
            ]),
          },
        ],
      }),
    )

    const citationCalls = (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([channel]) => channel === IPC_CHANNELS.CHAT_CITATION,
    )
    expect(citationCalls).toHaveLength(1)
    expect(citationCalls[0][1]).toEqual({
      messageId: 'asst-1',
      index: 1,
      citation: expect.objectContaining({
        citationIndex: 1,
        excerpt: 'corridor assemblies shall achieve 2 hours',
      }),
    })
  })
})
