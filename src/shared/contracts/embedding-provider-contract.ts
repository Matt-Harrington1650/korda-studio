export type EmbeddingInputType = 'document' | 'query'

export interface EmbeddingProvider {
  embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]>
  readonly dimensions: number
  readonly modelId: string
  readonly maxBatchSize: number
}

export interface RerankerProvider {
  rerank(query: string, documents: string[], topN: number): Promise<RerankResult[]>
  readonly rerankModelId: string
}

export interface RerankResult {
  index: number
  relevanceScore: number
}

export interface EmbeddingStats {
  embedded: number
  total: number
  percent: number
  isReady: boolean
  hasProvider: boolean
}
