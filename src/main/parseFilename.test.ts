// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseFilename } from './parseFilename'

describe('parseFilename — docType', () => {
  it('classifies .dwg as drawing', () => {
    expect(parseFilename('C-101_IFC.dwg').docType).toBe('drawing')
  })
  it('classifies .dxf as drawing', () => {
    expect(parseFilename('plan.dxf').docType).toBe('drawing')
  })
  it('classifies .dgn as drawing', () => {
    expect(parseFilename('plan.dgn').docType).toBe('drawing')
  })
  it('classifies .jpg as photo', () => {
    expect(parseFilename('site_photo_2024-03-01.jpg').docType).toBe('photo')
  })
  it('classifies .tif as photo', () => {
    expect(parseFilename('scan.tif').docType).toBe('photo')
  })
  it('classifies .xlsx as calculation', () => {
    expect(parseFilename('beam_design.xlsx').docType).toBe('calculation')
  })
  it('classifies .xlsb as calculation', () => {
    expect(parseFilename('data.xlsb').docType).toBe('calculation')
  })
  it('classifies name containing "calc" as calculation', () => {
    expect(parseFilename('Footing_Calc_Rev2.pdf').docType).toBe('calculation')
  })
  it('classifies name containing "submittal" as submittal', () => {
    expect(parseFilename('Steel_Submittal_001.pdf').docType).toBe('submittal')
  })
  it('classifies name containing "spec" as spec', () => {
    expect(parseFilename('Technical_Spec_Division03.pdf').docType).toBe('spec')
  })
  it('classifies name containing "report" as report', () => {
    expect(parseFilename('Geotech_Report_Final.pdf').docType).toBe('report')
  })
  it('classifies name containing "contract" as contract', () => {
    expect(parseFilename('Contract_Amendment_2.docx').docType).toBe('contract')
  })
  it('classifies .pdf without keyword match as report (fallback)', () => {
    expect(parseFilename('Meeting_Minutes_2024-01-15.pdf').docType).toBe('report')
  })
  it('classifies .docx without keyword match as report (fallback)', () => {
    expect(parseFilename('Notes.docx').docType).toBe('report')
  })
  it('classifies unknown extension as other', () => {
    expect(parseFilename('data.zip').docType).toBe('other')
  })
  it('drawing check runs before calc fallback — .dwg with "calc" in name is drawing', () => {
    expect(parseFilename('calc_overlay.dwg').docType).toBe('drawing')
  })
  it('photo check runs before doc fallback — .jpg is photo not report', () => {
    expect(parseFilename('report_scan.jpg').docType).toBe('photo')
  })
})

describe('parseFilename — drawingNumber', () => {
  it('extracts standard civil drawing number', () => {
    expect(parseFilename('C-101_IFC_Rev_A.pdf').drawingNumber).toBe('C-101')
  })
  it('extracts structural drawing number with suffix letter', () => {
    expect(parseFilename('S-201A_DD.pdf').drawingNumber).toBe('S-201A')
  })
  it('extracts two-letter prefix', () => {
    expect(parseFilename('EL-301_Final.dwg').drawingNumber).toBe('EL-301')
  })
  it('extracts four-digit number', () => {
    expect(parseFilename('C-1001_IFC.pdf').drawingNumber).toBe('C-1001')
  })
  it('returns null when no drawing number present', () => {
    expect(parseFilename('Meeting_Minutes.pdf').drawingNumber).toBeNull()
  })
  it('returns first match when multiple patterns present', () => {
    expect(parseFilename('C-101_C-102_combined.pdf').drawingNumber).toBe('C-101')
  })
})

describe('parseFilename — revision', () => {
  it('extracts _Rev_A format', () => {
    expect(parseFilename('C-101_Rev_A.pdf').revision).toBe('A')
  })
  it('extracts _RevA format (no separator)', () => {
    expect(parseFilename('Drawing_RevA.pdf').revision).toBe('A')
  })
  it('extracts _REV-B format (uppercase, dash separator)', () => {
    expect(parseFilename('Drawing_REV-B.pdf').revision).toBe('B')
  })
  it('extracts _r1 lowercase short format', () => {
    expect(parseFilename('plan_r1.dwg').revision).toBe('1')
  })
  it('extracts FINAL as revision', () => {
    expect(parseFilename('Report_FINAL.pdf').revision).toBe('FINAL')
  })
  it('returns null when no revision present', () => {
    expect(parseFilename('C-101.pdf').revision).toBeNull()
  })
})

describe('parseFilename — issueStatus', () => {
  it('detects IFC', () => {
    expect(parseFilename('C-101_IFC_Rev_A.pdf').issueStatus).toBe('IFC')
  })
  it('detects IFB', () => {
    expect(parseFilename('C-101_IFB.pdf').issueStatus).toBe('IFB')
  })
  it('detects IFR', () => {
    expect(parseFilename('Drawing_IFR.dwg').issueStatus).toBe('IFR')
  })
  it('detects AFC', () => {
    expect(parseFilename('S-201_AFC.pdf').issueStatus).toBe('AFC')
  })
  it('detects SD', () => {
    expect(parseFilename('C-101_SD.pdf').issueStatus).toBe('SD')
  })
  it('detects DD', () => {
    expect(parseFilename('C-101_DD.pdf').issueStatus).toBe('DD')
  })
  it('detects CD', () => {
    expect(parseFilename('C-101_CD.pdf').issueStatus).toBe('CD')
  })
  it('is case-insensitive — detects lowercase ifc', () => {
    expect(parseFilename('drawing_ifc.pdf').issueStatus).toBe('IFC')
  })
  it('returns null when no status token present', () => {
    expect(parseFilename('C-101_Rev_A.pdf').issueStatus).toBeNull()
  })
})

describe('parseFilename — fileDateMs', () => {
  it('extracts YYYYMMDD date', () => {
    const result = parseFilename('C-101_20240315.pdf')
    expect(result.fileDateMs).toBe(new Date(2024, 2, 15).getTime())
  })
  it('extracts YYYY-MM-DD date', () => {
    const result = parseFilename('report_2024-03-15.pdf')
    expect(result.fileDateMs).toBe(new Date(2024, 2, 15).getTime())
  })
  it('extracts YYYY_MM_DD date', () => {
    const result = parseFilename('site_photo_2024_03_15.jpg')
    expect(result.fileDateMs).toBe(new Date(2024, 2, 15).getTime())
  })
  it('returns null when no date present', () => {
    expect(parseFilename('C-101_IFC.pdf').fileDateMs).toBeNull()
  })
  it('returns null for invalid month (13)', () => {
    expect(parseFilename('report_20241301.pdf').fileDateMs).toBeNull()
  })
  it('returns null for invalid day (00)', () => {
    expect(parseFilename('report_20240300.pdf').fileDateMs).toBeNull()
  })
})
