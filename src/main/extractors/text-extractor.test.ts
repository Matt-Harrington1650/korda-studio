import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractText } from './text-extractor'

describe('text-extractor', () => {
  it('extracts content from a .txt file', async () => {
    const tmp = path.join(os.tmpdir(), 'test.txt')
    fs.writeFileSync(tmp, 'Hello extraction world')

    const result = await extractText(tmp)

    expect(result.text).toBe('Hello extraction world')
    fs.unlinkSync(tmp)
  })

  it('extracts content from a .md file', async () => {
    const tmp = path.join(os.tmpdir(), 'test.md')
    fs.writeFileSync(tmp, '# Heading\n\nSome text')

    const result = await extractText(tmp)

    expect(result.text).toContain('Heading')
    fs.unlinkSync(tmp)
  })

  it('throws if file cannot be read as UTF-8 text', async () => {
    const tmp = path.join(os.tmpdir(), 'test.bin')
    fs.writeFileSync(tmp, Buffer.from([0x00, 0xff, 0xfe, 0x00]))

    await expect(extractText(tmp)).rejects.toThrow()
    fs.unlinkSync(tmp)
  })
})
