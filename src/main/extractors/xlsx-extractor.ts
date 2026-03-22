import * as XLSX from 'xlsx'

export interface XlsxExtractResult {
  sheets: Array<{ name: string; text: string }>
}

export function extractXlsx(filePath: string): XlsxExtractResult {
  const workbook = XLSX.readFile(filePath)
  const sheets: Array<{ name: string; text: string }> = []

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name]
    const text = XLSX.utils.sheet_to_csv(sheet, { FS: '\t' }).trim()
    if (text.length === 0) continue

    sheets.push({ name, text })
  }

  return { sheets }
}
