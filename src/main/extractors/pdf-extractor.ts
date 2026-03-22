import fs from 'node:fs/promises'
import { PDFParse } from 'pdf-parse'

export interface PdfExtractResult {
  text: string
  pageTexts: string[]
  pageCount: number
}

export async function extractPdf(filePath: string): Promise<PdfExtractResult> {
  const buffer = await fs.readFile(filePath)
  const parser = new PDFParse({ data: buffer })
  const data = await parser.getText()
  const pageTexts = data.pages.map((page: { text: string }) => page.text)
  await parser.destroy()

  return {
    text: data.text,
    pageTexts,
    pageCount: data.total,
  }
}
