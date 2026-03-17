export interface ParsedFilename {
  docType: 'drawing' | 'spec' | 'calculation' | 'report' | 'submittal' | 'contract' | 'photo' | 'other'
  drawingNumber: string | null
  revision: string | null
  issueStatus: 'IFC' | 'IFB' | 'IFR' | 'AFC' | 'SD' | 'DD' | 'CD' | null
  fileDateMs: number | null
}

const ISSUE_STATUSES = ['IFC', 'IFB', 'IFR', 'AFC', 'SD', 'DD', 'CD'] as const

type IssueStatus = (typeof ISSUE_STATUSES)[number]

export function parseFilename(filename: string): ParsedFilename {
  const lastDot = filename.lastIndexOf('.')
  const stem = lastDot >= 0 ? filename.slice(0, lastDot) : filename
  const ext = lastDot >= 0 ? filename.slice(lastDot + 1).toLowerCase() : ''
  const nameLower = filename.toLowerCase()

  return {
    docType: classifyDocType(ext, nameLower),
    drawingNumber: extractDrawingNumber(stem),
    revision: extractRevision(stem),
    issueStatus: extractIssueStatus(filename),
    fileDateMs: extractFileDate(filename),
  }
}

function classifyDocType(ext: string, nameLower: string): ParsedFilename['docType'] {
  // Order is load-bearing — do not reorder these checks
  if (['dwg', 'dxf', 'dgn'].includes(ext)) return 'drawing'
  if (['jpg', 'jpeg', 'png', 'tif', 'tiff'].includes(ext)) return 'photo'
  if (['xlsx', 'xlsb', 'xls'].includes(ext) || nameLower.includes('calc')) return 'calculation'
  if (nameLower.includes('submittal')) return 'submittal'
  if (nameLower.includes('spec')) return 'spec'
  if (nameLower.includes('report')) return 'report'
  if (nameLower.includes('contract')) return 'contract'
  if (['pdf', 'docx', 'doc'].includes(ext)) return 'report'
  return 'other'
}

function extractDrawingNumber(stem: string): string | null {
  // Underscores act as separators, so split on them and look for drawing-number tokens
  const tokens = stem.split('_')
  for (const token of tokens) {
    const match = token.match(/^([A-Z]{1,2}-\d{3,4}[A-Z]?)$/i)
    if (match) return match[1].toUpperCase()
  }
  return null
}

function extractRevision(stem: string): string | null {
  // _Rev_A, _REV-B, _RevA formats
  const revMatch = stem.match(/_[Rr][Ee][Vv][-_]?([A-Z0-9]+)/i)
  if (revMatch) return revMatch[1].toUpperCase()
  // _r1 short format
  const rMatch = stem.match(/_[Rr](\d+)/)
  if (rMatch) return rMatch[1]
  // FINAL as a separator-delimited token (underscores used as separators)
  const tokens = stem.split('_')
  if (tokens.some(t => t.toUpperCase() === 'FINAL')) return 'FINAL'
  return null
}

function extractIssueStatus(filename: string): IssueStatus | null {
  // Underscores act as separators; split the stem on separators and check each token
  const lastDot = filename.lastIndexOf('.')
  const stem = lastDot >= 0 ? filename.slice(0, lastDot) : filename
  const tokens = stem.split(/[_\-.]/).map(t => t.toUpperCase())
  for (const status of ISSUE_STATUSES) {
    if (tokens.includes(status)) return status
  }
  return null
}

function extractFileDate(filename: string): number | null {
  const match = filename.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/)
  if (!match) return null
  const year = parseInt(match[1], 10)
  const month = parseInt(match[2], 10) - 1  // 0-indexed
  const day = parseInt(match[3], 10)
  const date = new Date(year, month, day)
  // Validate: JS Date auto-corrects invalid dates (e.g. month 13 → next year)
  // so we must round-trip to confirm the values are unchanged.
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null
  }
  return date.getTime()
}
