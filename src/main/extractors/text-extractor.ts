import fs from 'node:fs/promises'

export interface TextExtractResult {
  text: string
}

export async function extractText(filePath: string): Promise<TextExtractResult> {
  const text = await fs.readFile(filePath, 'utf-8')
  if (text.includes('\uFFFD')) {
    throw new Error(`File appears to be binary, not text: ${filePath}`)
  }

  return { text }
}
