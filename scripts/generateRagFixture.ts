// scripts/generateRagFixture.ts
// Run once: npx tsx scripts/generateRagFixture.ts
// Then commit the generated PDF binary.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// __dirname is not available in ESM — derive it from import.meta.url
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const OUT_PATH = path.resolve(
  __dirname,
  '../src/main/__testdata__/projects/PROJ-003/Riverfront_Plaza_Geotech_Report.pdf',
)

const SECTIONS = [
  {
    title: '1. Executive Summary',
    body: `This geotechnical investigation was carried out for the proposed Riverfront Plaza
development at 42 Riverfront Avenue. Three boreholes (BH-1, BH-2, BH-3) were advanced
to depths of 15 m. The site is underlain by approximately 6 m of loose fill material
overlying dense gravels. The fill layer presents challenges for shallow foundations and
should be considered in all structural design decisions.`,
  },
  {
    title: '2. Soil Profile and Stratigraphy',
    body: `Borehole logs indicate the following stratigraphy from surface:
0–6 m: Loose fill comprising demolition rubble, sand, and clay. Standard Penetration Test
(SPT) N-values range from 3 to 8, indicating very loose to loose consistency.
6–15 m: Dense sandy gravel with cobbles. SPT N-values range from 22 to 35, indicating
dense to very dense material. This stratum provides suitable bearing for foundations.`,
  },
  {
    title: '3. Foundation Recommendations',
    body: `Based on the soil conditions encountered, the following foundation options are recommended:
Shallow Foundations: Strip or pad footings founded at a minimum depth of 2.5 m below
finished floor level, bearing on the dense gravel stratum. The allowable bearing capacity
at this level is 120 kPa. Settlement is estimated at less than 25 mm.
Driven Piles: As an alternative for heavily loaded columns, driven piles should be taken
to a minimum depth of 14 m to develop adequate skin friction and end bearing in the dense
gravel. This option is recommended where column loads exceed 500 kN.`,
  },
  {
    title: '4. Groundwater Conditions',
    body: `Groundwater was encountered during drilling at a depth of 1.8 m below existing ground
level. Seasonal variation of ±0.5 m is anticipated based on regional data. Temporary
dewatering will be required during construction of any excavations below 1.5 m depth.
Permanent waterproofing measures should be provided for all below-ground structures.
Groundwater is classified as mildly aggressive to concrete (Class XA1 per EN 206).`,
  },
  {
    title: '5. Seismic Assessment and Liquefaction',
    body: `The site is located in a moderate seismic zone with a design peak ground acceleration of
Ia = 0.18g. The loose saturated sands within the fill layer between 1 m and 4 m depth are
susceptible to liquefaction during a design earthquake event. Seismic amplification effects
are expected due to the soft fill overlying dense gravel. Mitigation measures including
vibro-compaction or removal and replacement of the fill are recommended prior to
construction. Dynamic compaction is also a viable alternative.`,
  },
]

async function generate(): Promise<void> {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const pageWidth = 595
  const pageHeight = 842
  const marginX = 60
  const marginTop = 60
  const marginBottom = 60
  const lineHeight = 16
  const titleSize = 13
  const bodySize = 11

  // Title page
  let page = pdfDoc.addPage([pageWidth, pageHeight])
  let y = pageHeight - marginTop

  page.drawText('GEOTECHNICAL INVESTIGATION REPORT', {
    x: marginX,
    y: y - 20,
    size: 16,
    font: boldFont,
    color: rgb(0, 0, 0),
  })
  y -= 50

  page.drawText('Riverfront Plaza Development', {
    x: marginX,
    y,
    size: 14,
    font: boldFont,
    color: rgb(0, 0, 0),
  })
  y -= 24

  page.drawText('42 Riverfront Avenue', {
    x: marginX,
    y,
    size: bodySize,
    font,
    color: rgb(0, 0, 0),
  })
  y -= lineHeight
  page.drawText('Project Reference: PROJ-003', {
    x: marginX,
    y,
    size: bodySize,
    font,
    color: rgb(0, 0, 0),
  })
  y -= lineHeight
  page.drawText('Date: March 2026', {
    x: marginX,
    y,
    size: bodySize,
    font,
    color: rgb(0, 0, 0),
  })

  // Sections
  for (const section of SECTIONS) {
    page = pdfDoc.addPage([pageWidth, pageHeight])
    y = pageHeight - marginTop

    // Section title
    page.drawText(section.title, {
      x: marginX,
      y,
      size: titleSize,
      font: boldFont,
      color: rgb(0, 0, 0),
    })
    y -= titleSize + 8

    // Body text — word-wrap manually
    const maxWidth = pageWidth - marginX * 2
    const words = section.body.replace(/\n/g, ' \n ').split(' ')
    let line = ''

    for (const word of words) {
      if (word === '\n') {
        // Draw current line and add paragraph gap
        if (line.trim()) {
          page.drawText(line.trim(), { x: marginX, y, size: bodySize, font, color: rgb(0, 0, 0) })
          y -= lineHeight
        }
        y -= lineHeight / 2
        line = ''
        continue
      }

      const test = line ? `${line} ${word}` : word
      const testWidth = font.widthOfTextAtSize(test, bodySize)

      if (testWidth > maxWidth && line) {
        page.drawText(line, { x: marginX, y, size: bodySize, font, color: rgb(0, 0, 0) })
        y -= lineHeight
        line = word

        if (y < marginBottom) {
          page = pdfDoc.addPage([pageWidth, pageHeight])
          y = pageHeight - marginTop
        }
      } else {
        line = test
      }
    }

    if (line.trim()) {
      page.drawText(line.trim(), { x: marginX, y, size: bodySize, font, color: rgb(0, 0, 0) })
    }
  }

  const bytes = await pdfDoc.save()
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, bytes)
  console.log(`✓ Written: ${OUT_PATH} (${bytes.byteLength} bytes)`)
}

generate().catch((err) => {
  console.error(err)
  process.exit(1)
})
