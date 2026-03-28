// e2e/necEval.spec.ts
//
// Evaluation harness: fires 20 NEC questions through the grounded RAG pipeline
// against whatever content is already indexed in the running app.
// No reindexing — uses your live knowledge base.
//
// Run with:
//   cd korda-studio
//   $env:VOYAGE_API_KEY='...'; $env:ANTHROPIC_API_KEY='...'
//   npx cross-env playwright test e2e/necEval.spec.ts --timeout 300000

import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './fixtures/launchApp'
import type { AppHandle } from './fixtures/launchApp'
import { configureAISettings } from './fixtures/configureAISettings'
import { sendChatMessage } from './fixtures/sendChatMessage'
import type { ParsedCitation } from './fixtures/getCitationsFromLastMessage'

// ─── Environment guard ───────────────────────────────────────────────────────
test.skip(
  !process.env.VOYAGE_API_KEY || !process.env.ANTHROPIC_API_KEY,
  'Skipped: set VOYAGE_API_KEY + ANTHROPIC_API_KEY to run NEC eval',
)

// Global timeout — 20 questions at ~45 s each + setup = ~15 min ceiling
test.setTimeout(900_000)

// ─── 20 NEC evaluation questions ─────────────────────────────────────────────
const NEC_QUESTIONS: { id: string; question: string; topic: string }[] = [
  {
    id: 'Q01',
    topic: 'Ampacity / Wire Sizing',
    question:
      'What is the minimum wire gauge required for a 20-ampere branch circuit supplying receptacles?',
  },
  {
    id: 'Q02',
    topic: 'GFCI Protection',
    question:
      'Which locations in a dwelling unit require GFCI protection for 125-volt receptacles?',
  },
  {
    id: 'Q03',
    topic: 'AFCI Protection',
    question:
      'What NEC article governs arc-fault circuit-interrupter protection, and which circuits require it?',
  },
  {
    id: 'Q04',
    topic: 'Box Fill Calculations',
    question:
      'How is box fill calculated for conductors, devices, and equipment grounding conductors under NEC Article 314?',
  },
  {
    id: 'Q05',
    topic: 'Conduit Fill',
    question:
      'What are the maximum conduit fill percentages for one, two, and three or more conductors in a conduit?',
  },
  {
    id: 'Q06',
    topic: 'Grounding and Bonding',
    question:
      'What is the difference between grounding and bonding under the NEC, and why are both required?',
  },
  {
    id: 'Q07',
    topic: 'Service Entrance',
    question:
      'What clearances are required for service-entrance conductors passing over rooftops and near windows?',
  },
  {
    id: 'Q08',
    topic: 'Panelboard Requirements',
    question:
      'What are the NEC working-space clearance requirements in front of an electrical panelboard?',
  },
  {
    id: 'Q09',
    topic: 'Kitchen Circuits',
    question:
      'How many small-appliance branch circuits are required for the kitchen and dining areas of a dwelling unit?',
  },
  {
    id: 'Q10',
    topic: 'Bathroom Circuits',
    question:
      'What NEC requirement governs bathroom receptacle circuits in dwelling units, and can lighting be on the same circuit?',
  },
  {
    id: 'Q11',
    topic: 'Outdoor/Wet Locations',
    question:
      'What enclosure rating is required for receptacles installed in outdoor or wet locations?',
  },
  {
    id: 'Q12',
    topic: 'Motor Circuits',
    question:
      'How is the branch-circuit conductor size determined for a single-phase motor under NEC Article 430?',
  },
  {
    id: 'Q13',
    topic: 'Overcurrent Protection',
    question:
      'What is the standard ampere rating series for fuses and circuit breakers listed in NEC Article 240?',
  },
  {
    id: 'Q14',
    topic: 'Load Calculations',
    question:
      'How is the general lighting load calculated for a dwelling unit in a service load calculation?',
  },
  {
    id: 'Q15',
    topic: 'Conductor Insulation',
    question:
      'What are the temperature ratings for THHN, THWN, and XHHW conductor insulation types?',
  },
  {
    id: 'Q16',
    topic: 'Cable Types',
    question: 'Where is NM-B cable (Romex) permitted and prohibited under the NEC?',
  },
  {
    id: 'Q17',
    topic: 'Photovoltaic Systems',
    question:
      'What NEC article covers photovoltaic solar energy systems, and what are the key disconnecting means requirements?',
  },
  {
    id: 'Q18',
    topic: 'Generators',
    question:
      'What are the NEC requirements for transfer switches when a standby generator is connected to a building electrical system?',
  },
  {
    id: 'Q19',
    topic: 'Hazardous Locations',
    question:
      'How does the NEC classify hazardous locations by class and division, and what is a Class I Division 1 location?',
  },
  {
    id: 'Q20',
    topic: 'Voltage Drop',
    question:
      'What voltage drop limits does the NEC recommend for branch circuits and feeders, and how is voltage drop calculated?',
  },
]

// ─── Result tracking ─────────────────────────────────────────────────────────
interface EvalResult {
  id: string
  topic: string
  question: string
  citationCount: number
  citations: ParsedCitation[]
  answerLength: number
  answerSnippet: string
  durationMs: number
  error?: string
}

// ─── Shared state ─────────────────────────────────────────────────────────────
let handle: AppHandle
const results: EvalResult[] = []

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function navigateToChatWithAllSources(): Promise<void> {
  const { page } = handle
  await page.click('a[href="/chat"]')
  await page.waitForSelector('button:has-text("New Chat")', { timeout: 10_000 })
  await page.click('button:has-text("New Chat")')
  await page.waitForSelector('[aria-label="Message input"]', { timeout: 10_000 })

  // Open scope selector and check all sources
  await page.click('[aria-label="Scope"]')
  await page.waitForSelector('[aria-label="Scope options"]', { timeout: 5_000 })
  await page.waitForSelector('[aria-label="Scope options"] section input[type="checkbox"]', {
    timeout: 10_000,
  })
  const sourceCheckboxes = page
    .locator('[aria-label="Scope options"] section')
    .first()
    .locator('input[type="checkbox"]')
  const sourceCount = await sourceCheckboxes.count()
  for (let i = 0; i < sourceCount; i++) {
    const cb = sourceCheckboxes.nth(i)
    if (!(await cb.isChecked())) await cb.check()
  }
  await page.click('button:has-text("Search these")')
}

async function startFreshChat(): Promise<void> {
  const { page } = handle
  await page.waitForSelector('button:has-text("New Chat")', { timeout: 10_000 })
  await page.click('button:has-text("New Chat")')
  await page.waitForSelector('[aria-label="Message input"]', { timeout: 10_000 })
}

function printResultsTable(): void {
  const separator = '═'.repeat(110)
  const thin = '─'.repeat(110)
  console.log('\n' + separator)
  console.log('  NEC RAG EVALUATION — 20-QUESTION RESULTS')
  console.log(separator)

  for (const r of results) {
    const timeStr = r.error ? 'ERR' : `${(r.durationMs / 1000).toFixed(1)}s`
    console.log(`\n  ${r.id} | ${r.topic} | ${r.citationCount} citation(s) | ${timeStr}`)
    console.log(`  Q: ${r.question}`)

    if (r.error) {
      console.log(`  ✗ ERROR: ${r.error}`)
    } else if (r.citationCount === 0) {
      console.log(`  ✗ NO CITATIONS — answer: ${r.answerSnippet.replace(/\n/g, ' ').slice(0, 90)}`)
    } else {
      // Print each source doc name + excerpt snippet
      for (const c of r.citations) {
        const excerptSnip = c.excerpt.replace(/\n/g, ' ').slice(0, 80)
        console.log(`  ✓ [${c.fileName}] "${excerptSnip}"`)
      }
      console.log(`  → ${r.answerSnippet.replace(/\n/g, ' ').slice(0, 100)}`)
    }
    console.log(thin)
  }

  const answered = results.filter((r) => !r.error && r.citationCount > 0).length
  const errored = results.filter((r) => !!r.error).length
  const avgCitations =
    results.filter((r) => !r.error).reduce((sum, r) => sum + r.citationCount, 0) /
    Math.max(1, results.filter((r) => !r.error).length)
  const avgTime =
    results.filter((r) => !r.error).reduce((sum, r) => sum + r.durationMs, 0) /
    Math.max(1, results.filter((r) => !r.error).length) /
    1000

  console.log(
    `\n  SUMMARY  ${answered}/${NEC_QUESTIONS.length} grounded with citations | avg ${avgCitations.toFixed(1)} citations/question | avg ${avgTime.toFixed(1)}s | ${errored} errors`,
  )
  console.log(separator + '\n')
}

function saveResultsJson(): void {
  const outPath = path.join(__dirname, '../test-results/nec-eval.json')
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(
    outPath,
    JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2),
  )
  console.log(`[necEval] Results saved → ${outPath}`)
}

// ─── Suite ───────────────────────────────────────────────────────────────────
test.beforeAll(async () => {
  handle = await launchApp()
  const { page } = handle

  await page.waitForSelector('[aria-label="Module navigation"]', { timeout: 60_000 })

  // Configure AI keys + hybrid mode + reranking for best retrieval quality
  await configureAISettings(page, {
    voyageApiKey: process.env.VOYAGE_API_KEY!,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    retrievalMode: 'auto',
    useReranking: true,
  })

  await navigateToChatWithAllSources()
})

test.afterAll(async () => {
  printResultsTable()
  saveResultsJson()

  if (handle) {
    try {
      await configureAISettings(handle.page, { retrievalMode: 'auto', useReranking: false })
    } catch {
      // swallow cleanup errors
    }
    await closeApp(handle)
  }
})

// ─── One test per question ────────────────────────────────────────────────────
for (const q of NEC_QUESTIONS) {
  test(`${q.id}: ${q.topic}`, async () => {
    test.setTimeout(120_000)
    const { page } = handle

    await startFreshChat()

    const start = Date.now()
    let result: EvalResult
    try {
      const response = await sendChatMessage(page, q.question, 90_000)
      result = {
        id: q.id,
        topic: q.topic,
        question: q.question,
        citationCount: response.citations.length,
        citations: response.citations,
        answerLength: response.text.length,
        answerSnippet: response.text.slice(0, 120),
        durationMs: Date.now() - start,
      }
    } catch (err) {
      result = {
        id: q.id,
        topic: q.topic,
        question: q.question,
        citationCount: 0,
        citations: [],
        answerLength: 0,
        answerSnippet: '',
        durationMs: Date.now() - start,
        error: String(err).slice(0, 80),
      }
    }

    results.push(result)

    console.log(
      `[${q.id}] ${q.topic} — ${result.citationCount} citations, ${(result.durationMs / 1000).toFixed(1)}s`,
    )

    // Soft assertion: at minimum the agent should produce a non-empty answer
    if (!result.error) {
      expect(result.answerLength, `${q.id} produced empty answer`).toBeGreaterThan(0)
    }
  })
}
