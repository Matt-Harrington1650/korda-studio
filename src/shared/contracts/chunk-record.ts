export interface ChunkRecord {
  id: string // UUID
  fileId: number
  sourceId: string
  chunkIndex: number
  text: string
  tokenCount: number
  charCount: number
  pageNumber: number | null
  sectionTitle: string | null
  sheetName: string | null
  embedding: Buffer | null
  createdAt: number
}
