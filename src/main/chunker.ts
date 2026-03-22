import { randomUUID } from 'node:crypto'
import type { ChunkRecord } from '../shared/contracts/chunk-record'

const TARGET_CHARS = 2048
const OVERLAP_CHARS = 200
const MIN_CHARS = 100
const XLSX_GROUP_SIZE = 50

type TextInput = { type: 'text'; text: string; fileId: number; sourceId: string }
type PdfInput = {
  type: 'pdf'
  pageTexts: string[]
  pageCount: number
  fileId: number
  sourceId: string
}
type DocxInput = {
  type: 'docx'
  markdown: string
  headingMap: Map<number, string>
  fileId: number
  sourceId: string
}
type XlsxInput = {
  type: 'xlsx'
  sheets: Array<{ name: string; text: string }>
  fileId: number
  sourceId: string
}

export type ChunkInput = TextInput | PdfInput | DocxInput | XlsxInput

interface ChunkMeta {
  pageNumber?: number
  sectionTitle?: string
  sheetName?: string
}

export function chunk(input: ChunkInput): ChunkRecord[] {
  const createdAt = Date.now()
  const records: ChunkRecord[] = []
  let chunkIndex = 0

  const makeChunk = (text: string, meta: ChunkMeta): ChunkRecord => {
    const charCount = text.length
    return {
      id: randomUUID(),
      fileId: input.fileId,
      sourceId: input.sourceId,
      chunkIndex: chunkIndex++,
      text,
      tokenCount: Math.ceil(charCount / 4),
      charCount,
      pageNumber: meta.pageNumber ?? null,
      sectionTitle: meta.sectionTitle ?? null,
      sheetName: meta.sheetName ?? null,
      embedding: null,
      createdAt,
    }
  }

  const appendToPrevious = (text: string) => {
    const previous = records[records.length - 1]
    if (!previous) return false

    previous.text = `${previous.text} ${text}`.trim()
    previous.charCount = previous.text.length
    previous.tokenCount = Math.ceil(previous.charCount / 4)
    return true
  }

  const pushChunk = (text: string, meta: ChunkMeta, allowMerge = true) => {
    const trimmed = text.trim()
    if (!trimmed) return

    if (allowMerge && trimmed.length < MIN_CHARS && appendToPrevious(trimmed)) {
      return
    }

    records.push(makeChunk(trimmed, meta))
  }

  const splitText = (text: string, meta: ChunkMeta) => {
    const normalized = text.trim()
    if (!normalized) return

    if (normalized.length <= TARGET_CHARS) {
      pushChunk(normalized, meta, false)
      return
    }

    let start = 0
    while (start < normalized.length) {
      let end = Math.min(start + TARGET_CHARS, normalized.length)

      if (end < normalized.length) {
        const paragraphBreak = normalized.lastIndexOf('\n\n', end)
        if (paragraphBreak > start + MIN_CHARS) {
          end = paragraphBreak
        }
      }

      const slice = normalized.slice(start, end).trim()
      pushChunk(slice, meta)

      if (end >= normalized.length) break

      const nextStart = Math.max(end - OVERLAP_CHARS, start + 1)
      start = nextStart
    }
  }

  if (input.type === 'text') {
    splitText(input.text, {})
    return records
  }

  if (input.type === 'pdf') {
    input.pageTexts.forEach((pageText, index) => {
      splitText(pageText, { pageNumber: index + 1 })
    })
    return records
  }

  if (input.type === 'docx') {
    for (const section of splitAtHeadings(input.markdown, input.headingMap)) {
      splitText(section.text, { sectionTitle: section.heading })
    }
    return records
  }

  for (const sheet of input.sheets) {
    const rows = sheet.text.split('\n')
    for (let index = 0; index < rows.length; index += XLSX_GROUP_SIZE) {
      const text = rows
        .slice(index, index + XLSX_GROUP_SIZE)
        .join('\n')
        .trim()
      if (!text) continue

      const isFirstChunkForSheet = !records.some(
        (record) => record.sheetName === sheet.name && record.fileId === input.fileId,
      )
      pushChunk(text, { sheetName: sheet.name }, !isFirstChunkForSheet)
    }
  }

  return records
}

function splitAtHeadings(
  markdown: string,
  headingMap: Map<number, string>,
): Array<{ text: string; heading: string | undefined }> {
  if (headingMap.size === 0) {
    return [{ text: markdown, heading: undefined }]
  }

  const offsets = [...headingMap.keys()].sort((left, right) => left - right)
  const sections: Array<{ text: string; heading: string | undefined }> = []

  for (let index = 0; index < offsets.length; index++) {
    const start = offsets[index]
    const end = offsets[index + 1] ?? markdown.length
    sections.push({
      text: markdown.slice(start, end).trim(),
      heading: headingMap.get(start),
    })
  }

  return sections
}
