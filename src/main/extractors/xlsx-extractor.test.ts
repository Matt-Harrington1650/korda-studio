import { describe, expect, it, vi } from 'vitest'
import { extractXlsx } from './xlsx-extractor'

vi.mock('xlsx', () => ({
  readFile: vi.fn().mockReturnValue({
    SheetNames: ['Sheet1', 'Summary'],
    Sheets: {
      Sheet1: {},
      Summary: {},
    },
  }),
  utils: {
    sheet_to_csv: vi
      .fn()
      .mockReturnValueOnce('col1,col2\nval1,val2\nval3,val4')
      .mockReturnValueOnce('total,100'),
  },
}))

describe('xlsx-extractor', () => {
  it('returns one entry per sheet with name and text', () => {
    const result = extractXlsx('/fake/file.xlsx')

    expect(result.sheets).toHaveLength(2)
    expect(result.sheets[0].name).toBe('Sheet1')
    expect(result.sheets[0].text).toContain('val1')
  })

  it('skips empty sheets', async () => {
    const { utils } = await import('xlsx')
    vi.mocked(utils.sheet_to_csv).mockReturnValueOnce('').mockReturnValueOnce('data,here')

    const result = extractXlsx('/fake/file.xlsx')

    expect(result.sheets).toHaveLength(1)
    expect(result.sheets[0].name).toBe('Summary')
  })
})
