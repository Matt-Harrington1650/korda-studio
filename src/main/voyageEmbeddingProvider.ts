import { VoyageAIClient } from 'voyageai'
import type {
  EmbeddingInputType,
  EmbeddingProvider,
} from '../shared/contracts/embedding-provider-contract'

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = 1024
  readonly modelId = 'voyage-3'
  readonly maxBatchSize = 96

  private readonly client: VoyageAIClient

  constructor(apiKey: string) {
    this.client = new VoyageAIClient({ apiKey })
  }

  async embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
    const response = await this.client.embed({
      model: this.modelId,
      input: texts,
      inputType: inputType === 'query' ? 'query' : 'document',
    })

    return (response.data ?? []).map((item) => item.embedding ?? [])
  }
}
