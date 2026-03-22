export interface PipelineState {
  status: 'idle' | 'queued' | 'running' | 'complete' | 'failed'
  stage: string
  startedAt: number | null
  finishedAt: number | null
  error: string | null
}

export interface IndexRecord {
  id: string
  sourceId: string
  path: string
  name: string
  ext: string
  sizeBytes: number
  modifiedMs: number
  indexedAt: number
  contentHash: string
  chunkCount: number
  pipelineState: PipelineState
}
