export interface ChunkRecord {
  id: string
  indexRecordId: string
  chunkIndex: number
  text: string
  startChar: number | null
  endChar: number | null
  tokenCount: number | null
  pageNumber: number | null
  sectionTitle: string | null
  createdAt: number
  updatedAt: number
}
