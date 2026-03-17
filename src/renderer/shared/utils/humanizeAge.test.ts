import { describe, it, expect } from 'vitest'
import { humanizeAge } from './humanizeAge'

describe('humanizeAge', () => {
  it('returns "just now" for 0ms', () => {
    expect(humanizeAge(0)).toBe('just now')
  })

  it('returns "just now" for 59,999ms', () => {
    expect(humanizeAge(59_999)).toBe('just now')
  })

  it('returns "1 min ago" for exactly 60,000ms', () => {
    expect(humanizeAge(60_000)).toBe('1 min ago')
  })

  it('returns "1 min ago" for 90,000ms', () => {
    expect(humanizeAge(90_000)).toBe('1 min ago')
  })

  it('returns "59 min ago" for 3,599,999ms', () => {
    expect(humanizeAge(3_599_999)).toBe('59 min ago')
  })

  it('returns "1 hr ago" for exactly 3,600,000ms', () => {
    expect(humanizeAge(3_600_000)).toBe('1 hr ago')
  })

  it('returns "2 hr ago" for 7,200,000ms', () => {
    expect(humanizeAge(7_200_000)).toBe('2 hr ago')
  })
})
