import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractDocx } from './docx-extractor'

const { mockConvertToMarkdown } = vi.hoisted(() => ({
  mockConvertToMarkdown: vi.fn(),
}))

vi.mock('mammoth', () => ({
  default: {
    convertToMarkdown: mockConvertToMarkdown,
  },
}))

describe('docx-extractor', () => {
  beforeEach(() => {
    mockConvertToMarkdown.mockReset()
    mockConvertToMarkdown.mockResolvedValue({
      value: '# Introduction\n\nThis is the intro.\n\n## Methods\n\nThe methods section.',
      messages: [],
    })
  })

  it('returns markdown and a heading map', async () => {
    const result = await extractDocx('/fake/file.docx')

    expect(result.markdown).toContain('# Introduction')
    expect(result.headingMap).toBeInstanceOf(Map)
  })

  it('headingMap keys are character offsets of heading lines', async () => {
    const result = await extractDocx('/fake/file.docx')
    const entries = [...result.headingMap.entries()]

    expect(entries.length).toBeGreaterThan(0)
    expect(entries[0][1]).toBe('Introduction')
  })
})
