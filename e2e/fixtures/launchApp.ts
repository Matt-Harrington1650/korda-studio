// Launches the Electron app for E2E testing.
// Compiled main entry: .vite/build/main.js (output of @electron-forge/plugin-vite, confirmed in forge.config.ts)
// Prerequisite: run "npm start" at least once to generate .vite/build/main.js
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import path from 'node:path'

export interface AppHandle {
  app: ElectronApplication
  page: Page
}

export async function launchApp(): Promise<AppHandle> {
  const app = await electron.launch({
    args: [path.join(__dirname, '../../.vite/build/main.js')],
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

export async function closeApp(handle: AppHandle): Promise<void> {
  await handle.app.close()
}
