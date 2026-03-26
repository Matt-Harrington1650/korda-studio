import fs from 'node:fs'
import path from 'node:path'

export default function globalSetup(): void {
  const buildDir = path.resolve(__dirname, '../.vite/build')
  const mainEntry = path.join(buildDir, 'main.js')

  if (!fs.existsSync(mainEntry)) {
    throw new Error(
      `E2E prerequisite missing: ${mainEntry}\n` +
        `Run "npm start" once (then Ctrl+C after the app opens) to generate the compiled output, then re-run "npm run test:e2e".`,
    )
  }

  // pdfjs-dist loads pdf.worker.mjs relative to ingestionWorker.js at runtime.
  // The vite.worker.config.ts build plugin copies it automatically, but if a
  // developer runs e2e tests without a fresh npm start we still ensure it's present.
  const workerDest = path.join(buildDir, 'pdf.worker.mjs')
  if (!fs.existsSync(workerDest)) {
    const workerSrc = path.resolve(__dirname, '../node_modules/pdfjs-dist/build/pdf.worker.mjs')
    if (!fs.existsSync(workerSrc)) {
      throw new Error(
        `E2E prerequisite missing: ${workerSrc}\n` + `Run "npm install" to restore node_modules.`,
      )
    }
    fs.copyFileSync(workerSrc, workerDest)
    console.log(`[globalSetup] Copied pdf.worker.mjs → ${workerDest} (fallback)`)
  }
}
