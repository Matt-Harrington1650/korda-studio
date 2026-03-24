// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCohereClient } = vi.hoisted(() => {
  const hoistedCohereClient = vi.fn(
    class {
      embed = vi.fn()
      rerank = vi.fn()
    },
  )

  return {
    mockCohereClient: hoistedCohereClient,
  }
})

vi.mock('cohere-ai', () => ({
  CohereClient: mockCohereClient,
}))

import { CohereEmbeddingProvider } from './cohereEmbeddingProvider'

describe('CohereEmbeddingProvider', () => {
  let provider: CohereEmbeddingProvider
  let mockEmbed: ReturnType<typeof vi.fn>
  let mockRerank: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const { CohereClient } = await import('cohere-ai')
    provider = new CohereEmbeddingProvider('test-key')
    const instance = (CohereClient as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value
    mockEmbed = instance.embed
    mockRerank = instance.rerank
  })

  it('has correct metadata', () => {
    expect(provider.modelId).toBe('embed-english-v3.0')
    expect(provider.rerankModelId).toBe('rerank-english-v3.0')
    expect(provider.dimensions).toBe(1024)
  })

  it('embed calls with search_document inputType for documents', async () => {
    mockEmbed.mockResolvedValue({
      embeddings: {
        float: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
      },
    })

    const result = await provider.embed(['a', 'b'], 'document')

    expect(mockEmbed).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'embed-english-v3.0',
        inputType: 'search_document',
        embeddingTypes: ['float'],
      }),
    )
    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ])
  })

  it('embed uses search_query inputType for queries', async () => {
    mockEmbed.mockResolvedValue({ embeddings: { float: [[0.5]] } })

    await provider.embed(['q'], 'query')

    expect(mockEmbed).toHaveBeenCalledWith(expect.objectContaining({ inputType: 'search_query' }))
  })

  it('embed returns empty array when float is undefined', async () => {
    mockEmbed.mockResolvedValue({ embeddings: {} })

    const result = await provider.embed(['x'], 'document')

    expect(result).toEqual([])
  })

  it('rerank returns sorted results with index and score', async () => {
    mockRerank.mockResolvedValue({
      results: [
        { index: 2, relevanceScore: 0.9 },
        { index: 0, relevanceScore: 0.5 },
      ],
    })

    const result = await provider.rerank('query', ['a', 'b', 'c'], 2)

    expect(mockRerank).toHaveBeenCalledWith({
      model: 'rerank-english-v3.0',
      query: 'query',
      documents: ['a', 'b', 'c'],
      topN: 2,
    })
    expect(result).toEqual([
      { index: 2, relevanceScore: 0.9 },
      { index: 0, relevanceScore: 0.5 },
    ])
  })
})
