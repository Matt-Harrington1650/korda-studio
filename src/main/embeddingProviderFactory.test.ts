// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { AIConfig } from '../shared/ai-config'
import { DEFAULT_AI_CONFIG } from '../shared/ai-config'
import { createProviders } from './embeddingProviderFactory'

vi.mock('./voyageEmbeddingProvider', () => ({
  VoyageEmbeddingProvider: vi.fn(
    class {
      modelId = 'voyage-3'
      _key: string

      constructor(key: string) {
        this._key = key
      }
    },
  ),
}))

vi.mock('./cohereEmbeddingProvider', () => ({
  CohereEmbeddingProvider: vi.fn(
    class {
      modelId = 'embed-english-v3.0'
      rerankModelId = 'rerank-english-v3.0'
      _key: string

      constructor(key: string) {
        this._key = key
      }
    },
  ),
}))

function config(overrides: Partial<AIConfig>): AIConfig {
  return { ...DEFAULT_AI_CONFIG, ...overrides }
}

describe('createProviders', () => {
  it('returns null embedder when no keys configured', () => {
    const result = createProviders(config({}))

    expect(result.embedder).toBeNull()
    expect(result.reranker).toBeNull()
  })

  it('uses Voyage for embedding when voyageApiKey is set', () => {
    const result = createProviders(config({ voyageApiKey: 'voy-key' }))

    expect(result.embedder?.modelId).toBe('voyage-3')
    expect(result.reranker).toBeNull()
  })

  it('uses Cohere for embedding when only cohereApiKey is set', () => {
    const result = createProviders(config({ cohereApiKey: 'coh-key' }))

    expect(result.embedder?.modelId).toBe('embed-english-v3.0')
    expect(result.reranker).toBeNull()
  })

  it('uses Voyage for embedding and Cohere for reranking when both keys are set', () => {
    const result = createProviders(
      config({ voyageApiKey: 'voy-key', cohereApiKey: 'coh-key', useReranking: true }),
    )

    expect(result.embedder?.modelId).toBe('voyage-3')
    expect((result.reranker as { rerankModelId: string } | null)?.rerankModelId).toBe(
      'rerank-english-v3.0',
    )
  })

  it('does not set reranker when useReranking is false', () => {
    const result = createProviders(config({ cohereApiKey: 'coh-key', useReranking: false }))

    expect(result.reranker).toBeNull()
  })

  it('ignores whitespace-only API keys', () => {
    const result = createProviders(config({ voyageApiKey: '   ', cohereApiKey: '  ' }))

    expect(result.embedder).toBeNull()
  })
})
