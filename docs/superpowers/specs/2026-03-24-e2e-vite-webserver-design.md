# E2E Test Vite Dev Server — Design Spec

**Date:** 2026-03-24
**Scope:** Fix all Playwright e2e tests by adding a `webServer` entry to `playwright.config.ts` so the Vite renderer dev server starts automatically before any test run.

---

## 1. Problem

The compiled `.vite/build/main.js` (output of `electron-forge start`) has `MAIN_WINDOW_VITE_DEV_SERVER_URL = "http://localhost:5173"` baked in as a constant. When Playwright launches Electron via `electron.launch({ args: ['.vite/build/main.js'] })`, the main process calls `mainWindow.loadURL("http://localhost:5173")`. If no Vite dev server is running at that port, the renderer window loads a blank/error page and the React app never mounts. All `waitForSelector` calls time out.

This affects every spec in `e2e/` — both the pre-existing `happyPath.spec.ts` and the new `ragPipeline.spec.ts`.

---

## 2. Root Cause

`src/main/main.ts` line 155:

```typescript
if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
  mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL) // "http://localhost:5173"
} else {
  mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
}
```

`electron-forge start` compiles `main.ts` with `MAIN_WINDOW_VITE_DEV_SERVER_URL` set to the running dev server URL. The resulting `main.js` is reused for tests, but tests don't start the dev server.

---

## 3. Solution

Add a `webServer` block to `playwright.config.ts`. Playwright will:

1. Check if `localhost:5173` is already responding
2. If yes (`reuseExistingServer: true`) — use it (zero extra startup cost when `npm start` is already running)
3. If no — spawn `vite --config vite.renderer.config.mts`, wait up to 60 s for it to respond
4. Run all tests
5. Terminate the spawned Vite process when done

---

## 4. File Change

**Modify:** `playwright.config.ts`

Current:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  reporter: 'list',
  globalSetup: './e2e/globalSetup.ts',
  workers: 1,
})
```

After:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  reporter: 'list',
  globalSetup: './e2e/globalSetup.ts',
  workers: 1,
  webServer: {
    command: 'vite --config vite.renderer.config.mts',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
```

---

## 5. Why `vite` Without `npx`

`vite` resolves via `node_modules/.bin/vite` when run from the project root by Playwright's process spawner (same mechanism as npm scripts). No `npx` prefix is needed.

---

## 6. Why No React Plugin Needed

`vite.renderer.config.mts` has no `@vitejs/plugin-react`. JSX transforms work because:

- `tsconfig.json` sets `"jsx": "react-jsx"` (automatic runtime)
- Vite uses esbuild for TSX/JSX transformation, which respects the tsconfig setting
- No Fast Refresh (HMR) is needed for tests

---

## 7. Scope

- **Files changed:** 1 (`playwright.config.ts`)
- **Tests affected:** all specs in `e2e/` — both `happyPath.spec.ts` and `ragPipeline.spec.ts`
- **No app code changes**
- **No new dependencies**
