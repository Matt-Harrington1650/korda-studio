export type PipelineState =
  | 'new'
  | 'queued'
  | 'extracting'
  | 'chunking'
  | 'contextualizing'
  | 'indexed'
  | 'failed'
  | 'skipped'

export interface IndexRecord {
  fileId: number
  path: string
  name: string
  sourceId: string
  contentHash: string | null
  pipelineState: PipelineState
  pipelineError: string | null
  pipelineUpdatedAt: number | null
  pageCount: number | null
}
