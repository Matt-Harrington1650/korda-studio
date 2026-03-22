import fs from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractPdf } from './pdf-extractor'

const { mockGetText, mockDestroy, mockConstructor } = vi.hoisted(() => ({
  mockGetText: vi.fn(),
  mockDestroy: vi.fn(),
  mockConstructor: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
  },
}))

vi.mock('pdf-parse', () => ({
  PDFParse: class MockPDFParse {
    constructor(options: unknown) {
      mockConstructor(options)
    }

    getText = mockGetText
    destroy = mockDestroy
  },
}))

describe('pdf-extractor', () => {
  beforeEach(() => {
    vi.mocked(fs.readFile).mockResolvedValue(Buffer.from('fake-pdf'))
    mockGetText.mockReset()
    mockDestroy.mockReset()
    mockDestroy.mockResolvedValue(undefined)
    mockGetText.mockResolvedValue({
      text: 'Full document text',
      total: 3,
      pages: [
        { num: 1, text: 'Page 1' },
        { num: 2, text: 'Page 2' },
        { num: 3, text: 'Page 3' },
      ],
    })
  })

  it('returns text and page count', async () => {
    const result = await extractPdf('/fake/file.pdf')

    expect(result.text).toBe('Full document text')
    expect(result.pageCount).toBe(3)
    expect(mockConstructor).toHaveBeenCalledWith({ data: Buffer.from('fake-pdf') })
  })

  it('returns empty text for scanned PDF without throwing', async () => {
    mockGetText.mockResolvedValueOnce({
      text: '',
      total: 5,
      pages: [
        { num: 1, text: '' },
        { num: 2, text: '' },
        { num: 3, text: '' },
        { num: 4, text: '' },
        { num: 5, text: '' },
      ],
    })

    const result = await extractPdf('/fake/scanned.pdf')

    expect(result.text).toBe('')
    expect(result.pageCount).toBe(5)
  })
})
