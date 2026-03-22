import mammoth from 'mammoth'

export interface DocxExtractResult {
  markdown: string
  headingMap: Map<number, string>
}

interface MammothMarkdownApi {
  convertToMarkdown(input: { path: string }): Promise<{ value: string }>
}

export async function extractDocx(filePath: string): Promise<DocxExtractResult> {
  const mammothMarkdown = mammoth as unknown as MammothMarkdownApi
  const result = await mammothMarkdown.convertToMarkdown({ path: filePath })
  const markdown = result.value
  const headingMap = new Map<number, string>()
  const headingRe = /^#{1,6}\s+(.+)$/gm

  let match: RegExpExecArray | null
  while ((match = headingRe.exec(markdown)) !== null) {
    headingMap.set(match.index, match[1].trim())
  }

  return { markdown, headingMap }
}
