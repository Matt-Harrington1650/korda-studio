export interface Citation {
  citationIndex: number
  fileId: number
  filePath: string
  fileName: string
  chunkId: string
  excerpt: string
  pageNumber?: number | null
  sectionTitle: string | null
  sourceId: string
}

export type EvidenceStatus = 'supported' | 'partial' | 'unsupported'

export interface GroundedAnswer {
  text: string
  citations: Citation[]
  evidenceStatus: EvidenceStatus
  retrievedChunkCount: number
  searchQueriesUsed: string[]
}
