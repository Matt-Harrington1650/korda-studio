import { CohereClient } from 'cohere-ai'
import type {
  EmbeddingInputType,
  EmbeddingProvider,
  RerankResult,
  RerankerProvider,
} from '../shared/contracts/embedding-provider-contract'

export class CohereEmbeddingProvider implements EmbeddingProvider, RerankerProvider {
  readonly dimensions = 1024
  readonly modelId = 'embed-english-v3.0'
  readonly rerankModelId = 'rerank-english-v3.0'
  readonly maxBatchSize = 96

  private readonly client: CohereClient

  constructor(apiKey: string) {
    this.client = new CohereClient({ token: apiKey })
  }

  async embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
    const response = await this.client.embed({
      model: this.modelId,
      texts,
      inputType: inputType === 'query' ? 'search_query' : 'search_document',
      embeddingTypes: ['float'],
    })
    const byType = response as { embeddings: { float?: number[][] } }

    return byType.embeddings.float ?? []
  }

  async rerank(query: string, documents: string[], topN: number): Promise<RerankResult[]> {
    const response = await this.client.rerank({
      model: this.rerankModelId,
      query,
      documents,
      topN,
    })

    return response.results.map((result) => ({
      index: result.index,
      relevanceScore: Number(result.relevanceScore),
    }))
  }
}
