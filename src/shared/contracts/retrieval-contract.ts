import type { FileEntry } from '../ipc-types'
import type { ChunkRecord } from './chunk-record'

export interface RetrievalParams {
  query: string
  sourceId?: string
  project?: string
  limit?: number
  mode?: RetrievalMode
}

export type RetrievalMode = 'keyword' | 'vector' | 'hybrid' | 'auto'

export interface RetrievalResult {
  chunk: ChunkRecord
  file: FileEntry
  bm25Score: number | null
  vectorDistance: number | null
  rrfScore: number | null
  highlight: string
}

export interface RetrievalProvider {
  search(params: RetrievalParams): Promise<RetrievalResult[]>
  isVectorReady(): boolean
}
