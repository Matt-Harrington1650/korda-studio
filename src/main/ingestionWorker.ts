import Database from 'better-sqlite3'
import { parentPort, workerData } from 'node:worker_threads'
import { chunk } from './chunker'
import { extractDocx } from './extractors/docx-extractor'
import { extractPdf } from './extractors/pdf-extractor'
import { extractText } from './extractors/text-extractor'
import { extractXlsx } from './extractors/xlsx-extractor'
import type { ChunkRecord } from '../shared/contracts/chunk-record'
import type { PipelineState } from '../shared/contracts/index-record'

const port = (() => {
  if (!parentPort) {
    throw new Error('ingestionWorker requires a parentPort')
  }
  return parentPort
})()

const { dbPath } = workerData as { dbPath: string }
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 5000')
db.pragma('foreign_keys = ON')

type WorkerMessage = {
  type: 'job'
  fileId: number
  filePath: string
  sourceId: string
  ext: string
}

function normalizeExt(ext: string, filePath: string): string {
  const trimmed = ext.trim().toLowerCase()
  if (trimmed.startsWith('.')) {
    return trimmed
  }
  if (trimmed.length > 0) {
    return `.${trimmed}`
  }

  const lastDot = filePath.lastIndexOf('.')
  return lastDot >= 0 ? filePath.slice(lastDot).toLowerCase() : ''
}

function emitProgress(
  fileId: number,
  state: PipelineState,
  extra?: {
    chunkCount?: number
    error?: string
  },
) {
  port.postMessage({
    type: 'progress',
    fileId,
    state,
    ...(extra?.chunkCount != null ? { chunkCount: extra.chunkCount } : {}),
    ...(extra?.error ? { error: extra.error } : {}),
  })
}

function setState(
  fileId: number,
  state: PipelineState,
  extra?: {
    error?: string
    pageCount?: number | null
  },
) {
  db.prepare(
    `UPDATE files
     SET pipeline_state = ?,
         pipeline_error = ?,
         page_count = COALESCE(?, page_count),
         pipeline_updated_at = ?
     WHERE id = ?`,
  ).run(state, extra?.error ?? null, extra?.pageCount ?? null, Date.now(), fileId)

  emitProgress(fileId, state, extra?.error ? { error: extra.error } : undefined)
}

function replaceChunks(fileId: number, chunks: ChunkRecord[]) {
  const deleteChunks = db.prepare('DELETE FROM chunks WHERE file_id = ?')
  const insertChunk = db.prepare(
    `INSERT INTO chunks (
      id,
      file_id,
      source_id,
      chunk_index,
      text,
      token_count,
      char_count,
      page_number,
      section_title,
      sheet_name,
      embedding,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  db.transaction((rows: ChunkRecord[]) => {
    deleteChunks.run(fileId)
    for (const record of rows) {
      insertChunk.run(
        record.id,
        record.fileId,
        record.sourceId,
        record.chunkIndex,
        record.text,
        record.tokenCount,
        record.charCount,
        record.pageNumber,
        record.sectionTitle,
        record.sheetName,
        record.embedding,
        record.createdAt,
      )
    }
  })(chunks)
}

async function processJob(message: WorkerMessage) {
  const { fileId, filePath, sourceId } = message
  const ext = normalizeExt(message.ext, filePath)

  try {
    setState(fileId, 'extracting')

    let chunks: ChunkRecord[] = []
    let pageCount: number | null = null

    if (ext === '.txt' || ext === '.md') {
      const result = await extractText(filePath)
      setState(fileId, 'chunking')
      chunks = chunk({ type: 'text', text: result.text, fileId, sourceId })
    } else if (ext === '.pdf') {
      const result = await extractPdf(filePath)
      pageCount = result.pageCount
      setState(fileId, 'chunking', { pageCount })
      chunks = chunk({
        type: 'pdf',
        pageTexts: result.pageTexts,
        pageCount: result.pageCount,
        fileId,
        sourceId,
      })
    } else if (ext === '.docx') {
      const result = await extractDocx(filePath)
      setState(fileId, 'chunking')
      chunks = chunk({
        type: 'docx',
        markdown: result.markdown,
        headingMap: result.headingMap,
        fileId,
        sourceId,
      })
    } else if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
      const result = extractXlsx(filePath)
      setState(fileId, 'chunking')
      chunks = chunk({
        type: 'xlsx',
        sheets: result.sheets,
        fileId,
        sourceId,
      })
    } else {
      replaceChunks(fileId, [])
      setState(fileId, 'skipped')
      return
    }

    replaceChunks(fileId, chunks)
    setState(fileId, 'indexed', { pageCount })
    emitProgress(fileId, 'indexed', { chunkCount: chunks.length })
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error)
    setState(fileId, 'failed', { error: messageText })
    emitProgress(fileId, 'failed', { error: messageText })
  } finally {
    port.postMessage({ type: 'ready' })
  }
}

port.on('message', (message: WorkerMessage) => {
  if (message.type === 'job') {
    void processJob(message)
  }
})

port.postMessage({ type: 'ready' })
