import fs from 'node:fs/promises'
import pdfParse from 'pdf-parse'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractPdf } from './pdf-extractor'

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
  },
}))

vi.mock('pdf-parse', () => ({
  default: vi.fn(),
}))

describe('pdf-extractor', () => {
  beforeEach(() => {
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('fake-pdf'))
    vi.mocked(pdfParse).mockResolvedValue({
      text: 'Full document text',
      numpages: 3,
    } as Awaited<ReturnType<typeof pdfParse>>)
  })

  it('returns text and page count', async () => {
    const result = await extractPdf('/fake/file.pdf')

    expect(result.text).toBe('Full document text')
    expect(result.pageCount).toBe(3)
  })

  it('returns empty text for scanned PDF without throwing', async () => {
    vi.mocked(pdfParse).mockResolvedValueOnce({
      text: '',
      numpages: 5,
    } as Awaited<ReturnType<typeof pdfParse>>)

    const result = await extractPdf('/fake/scanned.pdf')

    expect(result.text).toBe('')
    expect(result.pageCount).toBe(5)
  })
})
