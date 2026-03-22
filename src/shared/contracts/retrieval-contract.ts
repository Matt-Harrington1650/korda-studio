import type { FileEntry } from '../ipc-types'

export interface RetrievalParams {
  query: string
  limit?: number
  sourceId?: string
  project?: string | string[]
  discipline?: string
  docType?: string
  ext?: string
}

export interface RetrievalHit {
  file: FileEntry
  score: number
  chunkId?: string
  chunkIndex?: number
  text?: string
  pageNumber?: number | null
  startChar?: number | null
  endChar?: number | null
}

export interface RetrievalResult {
  query: string
  hits: RetrievalHit[]
}

export interface RetrievalProvider {
  retrieve(params: RetrievalParams): Promise<RetrievalResult>
}
