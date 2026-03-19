import { detectSourceType } from './file-sources'

describe('detectSourceType', () => {
  it('detects network share from UNC path', () => {
    expect(detectSourceType('\\\\SERVER\\projects')).toBe('network-share')
  })

  it('detects network share from forward-slash UNC', () => {
    expect(detectSourceType('//SERVER/projects')).toBe('network-share')
  })

  it('detects sharepoint from https URL', () => {
    expect(detectSourceType('https://company.sharepoint.com/sites/docs')).toBe('sharepoint')
  })

  it('detects sharepoint from http URL', () => {
    expect(detectSourceType('http://intranet/docs')).toBe('sharepoint')
  })

  it('detects mapped drive from bare drive root Z:\\', () => {
    expect(detectSourceType('Z:\\')).toBe('mapped-drive')
  })

  it('detects mapped drive from bare drive root Z:', () => {
    expect(detectSourceType('Z:')).toBe('mapped-drive')
  })

  it('classifies drive path with subpath as local', () => {
    expect(detectSourceType('C:\\Projects')).toBe('local')
  })

  it('classifies relative path as local', () => {
    expect(detectSourceType('Projects')).toBe('local')
  })
})
