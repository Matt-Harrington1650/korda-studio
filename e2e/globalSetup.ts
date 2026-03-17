import fs from 'node:fs'
import path from 'node:path'

export default function globalSetup(): void {
  const mainEntry = path.resolve(__dirname, '../.vite/build/main.js')
  if (!fs.existsSync(mainEntry)) {
    throw new Error(
      `E2E prerequisite missing: ${mainEntry}\n` +
      `Run "npm start" once (then Ctrl+C after the app opens) to generate the compiled output, then re-run "npm run test:e2e".`
    )
  }
}
