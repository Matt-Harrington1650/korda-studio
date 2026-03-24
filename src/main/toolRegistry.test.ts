// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentTool } from '../shared/contracts/agent-tool-contract'
import { SEARCH_KNOWLEDGE_BASE_TOOL_NAME } from '../shared/contracts/agent-tool-contract'
import type { RetrievalResult } from '../shared/contracts/retrieval-contract'

const { mockSearch } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
}))

vi.mock('./retrievalService', () => ({
  retrievalService: {
    search: mockSearch,
  },
}))

import { ToolRegistryImpl, searchKnowledgeBaseTool, toolRegistry } from './toolRegistry'

function makeResult(
  id: string,
  score: number,
  sourceId = 'src1',
  project = 'proj1',
): RetrievalResult {
  return {
    chunk: {
      id,
      fileId: Number(id.replace(/\D/g, '') || '1'),
      sourceId,
      chunkIndex: 0,
      text: `text for ${id}`,
      tokenCount: 10,
      charCount: 50,
      pageNumber: 1,
      sectionTitle: 'Section',
      sheetName: null,
      embedding: null,
      createdAt: Date.now(),
    },
    file: {
      path: `/docs/${id}.pdf`,
      name: `${id}.pdf`,
      ext: '.pdf',
      sizeBytes: 100,
      modifiedMs: Date.now(),
      isDir: false,
      sourceId,
      project,
      discipline: null,
      docType: null,
      drawingNumber: null,
      revision: null,
      issueStatus: null,
    },
    bm25Score: score,
    vectorDistance: null,
    rrfScore: null,
    highlight: `highlight ${id}`,
  }
}

describe('ToolRegistryImpl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toolRegistry.reset()
    toolRegistry.register(searchKnowledgeBaseTool)
  })

  it('registers a tool and maps inputSchema to input_schema for Anthropic', () => {
    const registry = new ToolRegistryImpl()
    const tool: AgentTool = {
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'search query' },
        },
        required: ['query'],
      },
      execute: vi.fn().mockResolvedValue({ content: 'ok' }),
    }

    registry.register(tool)

    expect(registry.getSchemas()).toEqual([
      {
        name: 'test_tool',
        description: 'A test tool',
        input_schema: tool.inputSchema,
      },
    ])
  })

  it('dispatches execution to a registered tool', async () => {
    const registry = new ToolRegistryImpl()
    const execute = vi.fn().mockResolvedValue({ content: { ok: true } })
    registry.register({
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: { type: 'object', properties: {}, required: [] },
      execute,
    })

    const result = await registry.execute('test_tool', { alpha: 1 })

    expect(execute).toHaveBeenCalledWith({ alpha: 1 })
    expect(result).toEqual({ content: { ok: true } })
  })

  it('injects source and project scope into searchKnowledgeBaseTool calls', async () => {
    mockSearch
      .mockResolvedValueOnce([makeResult('chunk-a', 10, 'src1', 'proj1')])
      .mockResolvedValueOnce([makeResult('chunk-b', 8, 'src2', 'proj1')])

    toolRegistry.setScope({ sourceIds: ['src1', 'src2'], projects: ['proj1'] })

    await toolRegistry.execute(SEARCH_KNOWLEDGE_BASE_TOOL_NAME, {
      query: 'beam loads',
    })

    expect(mockSearch).toHaveBeenCalledTimes(2)
    expect(mockSearch).toHaveBeenNthCalledWith(1, {
      query: 'beam loads',
      sourceId: 'src1',
      project: 'proj1',
      limit: 10,
      mode: 'auto',
    })
    expect(mockSearch).toHaveBeenNthCalledWith(2, {
      query: 'beam loads',
      sourceId: 'src2',
      project: 'proj1',
      limit: 10,
      mode: 'auto',
    })
  })

  it('collects unique results sorted by bm25Score descending and capped at 20', async () => {
    mockSearch.mockResolvedValue(
      Array.from({ length: 22 }, (_, index) => makeResult(`chunk-${index}`, index + 1)),
    )

    toolRegistry.setScope({ sourceIds: [], projects: [] })
    await toolRegistry.execute(SEARCH_KNOWLEDGE_BASE_TOOL_NAME, { query: 'loads' })

    mockSearch.mockResolvedValue([makeResult('chunk-5', 999), makeResult('chunk-3', 777)])
    await toolRegistry.execute(SEARCH_KNOWLEDGE_BASE_TOOL_NAME, { query: 'corridor loads' })

    const results = toolRegistry.collectResults()

    expect(results).toHaveLength(20)
    expect(results[0].chunk.id).toBe('chunk-5')
    expect(results[1].chunk.id).toBe('chunk-3')
    expect(results.filter((result) => result.chunk.id === 'chunk-5')).toHaveLength(1)
  })

  it('returns an error tool result for invalid search input', async () => {
    const result = await toolRegistry.execute(SEARCH_KNOWLEDGE_BASE_TOOL_NAME, {
      query: 42,
    })

    expect(result).toEqual({
      content: 'search_knowledge_base requires a string query',
      isError: true,
    })
  })
})
