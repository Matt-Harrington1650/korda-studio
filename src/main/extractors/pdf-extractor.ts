import fs from 'node:fs/promises'
import pdfParse from 'pdf-parse'

export interface PdfExtractResult {
  text: string
  pageTexts: string[]
  pageCount: number
}

export async function extractPdf(filePath: string): Promise<PdfExtractResult> {
  const buffer = await fs.readFile(filePath)
  const data = await pdfParse(buffer)
  const pageTexts = data.text
    .split('\f')
    .map((page) => page.trim())
    .filter(Boolean)

  return {
    text: data.text,
    pageTexts,
    pageCount: data.numpages,
  }
}
