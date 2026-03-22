export interface Citation {
  filePath: string
  chunkId?: string
  chunkIndex?: number
  excerpt: string
  score?: number
  pageNumber?: number | null
  startChar?: number | null
  endChar?: number | null
}

export interface GroundedAnswer {
  answer: string
  citations: Citation[]
}
