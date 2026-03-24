// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockVoyageClient } = vi.hoisted(() => {
  const hoistedVoyageClient = vi.fn(
    class {
      embed = vi.fn()
    },
  )

  return {
    mockVoyageClient: hoistedVoyageClient,
  }
})

vi.mock('voyageai', () => ({
  VoyageAIClient: mockVoyageClient,
}))

import { VoyageEmbeddingProvider } from './voyageEmbeddingProvider'

describe('VoyageEmbeddingProvider', () => {
  let provider: VoyageEmbeddingProvider
  let mockEmbed: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const { VoyageAIClient } = await import('voyageai')
    provider = new VoyageEmbeddingProvider('test-key')
    mockEmbed = (VoyageAIClient as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value.embed
  })

  it('has correct metadata', () => {
    expect(provider.modelId).toBe('voyage-3')
    expect(provider.dimensions).toBe(1024)
    expect(provider.maxBatchSize).toBe(96)
  })

  it('calls embed with correct model and document inputType', async () => {
    mockEmbed.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
    })

    const result = await provider.embed(['hello', 'world'], 'document')

    expect(mockEmbed).toHaveBeenCalledWith({
      model: 'voyage-3',
      input: ['hello', 'world'],
      inputType: 'document',
    })
    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ])
  })

  it('calls embed with query inputType for queries', async () => {
    mockEmbed.mockResolvedValue({ data: [{ embedding: [0.5, 0.6] }] })

    await provider.embed(['search query'], 'query')

    expect(mockEmbed).toHaveBeenCalledWith(
      expect.objectContaining({
        inputType: 'query',
      }),
    )
  })

  it('handles null or undefined data gracefully', async () => {
    mockEmbed.mockResolvedValue({ data: undefined })

    const result = await provider.embed(['text'], 'document')

    expect(result).toEqual([])
  })

  it('propagates non-429 errors', async () => {
    mockEmbed.mockRejectedValue(new Error('API error'))

    await expect(provider.embed(['text'], 'document')).rejects.toThrow('API error')
  })
})
