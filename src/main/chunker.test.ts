import { describe, expect, it } from 'vitest'
import { chunk } from './chunker'

describe('chunker', () => {
  it('produces a single chunk for short text', () => {
    const chunks = chunk({
      type: 'text',
      text: 'Hello world',
      fileId: 1,
      sourceId: 'src1',
    })

    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe('Hello world')
    expect(chunks[0].fileId).toBe(1)
    expect(chunks[0].chunkIndex).toBe(0)
    expect(typeof chunks[0].id).toBe('string')
  })

  it('splits long text into multiple chunks', () => {
    const longText = 'word '.repeat(1000)
    const chunks = chunk({ type: 'text', text: longText, fileId: 2, sourceId: 'src1' })

    expect(chunks.length).toBeGreaterThan(1)
  })

  it('assigns page_number to PDF chunks', () => {
    const chunks = chunk({
      type: 'pdf',
      pageTexts: ['Page one content', 'Page two content'],
      pageCount: 2,
      fileId: 3,
      sourceId: 'src1',
    })

    expect(chunks[0].pageNumber).toBe(1)
    expect(chunks[1].pageNumber).toBe(2)
  })

  it('assigns section_title to docx chunks', () => {
    const markdown = '# Introduction\n\nText here.\n\n## Methods\n\nMore text.'
    const headingMap = new Map([
      [0, 'Introduction'],
      [25, 'Methods'],
    ])
    const chunks = chunk({ type: 'docx', markdown, headingMap, fileId: 4, sourceId: 'src1' })

    expect(chunks[0].sectionTitle).toBe('Introduction')
  })

  it('assigns sheet_name to xlsx chunks', () => {
    const chunks = chunk({
      type: 'xlsx',
      sheets: [{ name: 'Budget', text: 'row1\nrow2\nrow3' }],
      fileId: 5,
      sourceId: 'src1',
    })

    expect(chunks[0].sheetName).toBe('Budget')
  })

  it('chunk indexes are 0-based and sequential', () => {
    const longText = 'x '.repeat(2000)
    const chunks = chunk({ type: 'text', text: longText, fileId: 6, sourceId: 'src1' })

    chunks.forEach((entry, index) => expect(entry.chunkIndex).toBe(index))
  })

  it('tokenCount is ceil(charCount / 4)', () => {
    const chunks = chunk({ type: 'text', text: 'abcd', fileId: 7, sourceId: 'src1' })

    expect(chunks[0].charCount).toBe(4)
    expect(chunks[0].tokenCount).toBe(1)
  })
})
