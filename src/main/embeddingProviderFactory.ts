import type { AIConfig } from '../shared/ai-config'
import type {
  EmbeddingProvider,
  RerankerProvider,
} from '../shared/contracts/embedding-provider-contract'
import { CohereEmbeddingProvider } from './cohereEmbeddingProvider'
import { VoyageEmbeddingProvider } from './voyageEmbeddingProvider'

export interface ProviderSet {
  embedder: EmbeddingProvider | null
  reranker: RerankerProvider | null
}

export function createProviders(config: AIConfig): ProviderSet {
  const hasVoyage = Boolean(config.voyageApiKey?.trim())
  const hasCohere = Boolean(config.cohereApiKey?.trim())

  let embedder: EmbeddingProvider | null = null
  let reranker: RerankerProvider | null = null

  if (hasVoyage) {
    embedder = new VoyageEmbeddingProvider(config.voyageApiKey!)
  } else if (hasCohere) {
    embedder = new CohereEmbeddingProvider(config.cohereApiKey!)
  }

  if (hasCohere && config.useReranking) {
    reranker = new CohereEmbeddingProvider(config.cohereApiKey!)
  }

  return { embedder, reranker }
}
