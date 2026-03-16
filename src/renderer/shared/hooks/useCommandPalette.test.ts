import { scoreMatch } from './useCommandPalette'

describe('scoreMatch', () => {
  it('scores exact match highest', () => {
    expect(scoreMatch('Home', 'Home')).toBeGreaterThan(scoreMatch('Home', 'Ho'))
  })

  it('scores starts-with higher than contains', () => {
    expect(scoreMatch('Home', 'Ho')).toBeGreaterThan(scoreMatch('Home', 'om'))
  })

  it('returns 0 for no match', () => {
    expect(scoreMatch('Home', 'xyz')).toBe(0)
  })

  it('is case insensitive', () => {
    expect(scoreMatch('Home', 'home')).toBeGreaterThan(0)
  })
})
