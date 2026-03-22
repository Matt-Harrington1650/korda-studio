import mammoth from 'mammoth'

export interface DocxExtractResult {
  markdown: string
  headingMap: Map<number, string>
}

export async function extractDocx(filePath: string): Promise<DocxExtractResult> {
  const result = await mammoth.convertToMarkdown({ path: filePath })
  const markdown = result.value
  const headingMap = new Map<number, string>()
  const headingRe = /^#{1,6}\s+(.+)$/gm

  let match: RegExpExecArray | null
  while ((match = headingRe.exec(markdown)) !== null) {
    headingMap.set(match.index, match[1].trim())
  }

  return { markdown, headingMap }
}
