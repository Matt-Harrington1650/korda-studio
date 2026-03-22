export type FileSourceType = 'network-share' | 'local' | 'mapped-drive' | 'sharepoint'

export interface FileSource {
  id: string // UUID — never changes after creation
  displayName: string
  path: string // \\SERVER\share | C:\Projects | Z:\ | https://...
  type: FileSourceType // auto-detected, user-overrideable
  enabled: boolean
}

export interface SourceStatus {
  sourceId: string
  displayName: string
  path: string
  type: FileSourceType
  online: boolean
  status: 'idle' | 'crawling' | 'error' | 'not-configured' | 'disabled'
  fileCount: number
  lastCrawledMs: number | null
  crawlError: string | null
}

/**
 * Auto-detect source type from path. Always user-overrideable — this is a hint only.
 * mapped-drive: bare drive roots only (Z:\, Z:). Z:\Engineering → 'local'.
 */
export function detectSourceType(p: string): FileSourceType {
  if (/^\\\\/.test(p) || /^\/\//.test(p)) return 'network-share'
  if (/^https?:\/\//i.test(p)) return 'sharepoint'
  if (/^[a-zA-Z]:\\?$/.test(p.trim())) return 'mapped-drive'
  return 'local'
}
