# Full Test Suite & UI QoL — Design Spec
**Date:** 2026-03-17
**Project:** KORDA Studio
**Status:** Approved

---

## 1. Overview

This spec covers two parallel tracks executed sequentially in a single implementation plan:

- **Track 1 — Unit gap-fill + QoL upgrades:** Audit every module for missing Vitest/RTL test cases and implement quality-of-life feedback improvements simultaneously. Tests validate the upgrades as they land.
- **Track 2 — Playwright E2E harness:** After Track 1 is solid, a thin end-to-end suite drives the real Electron window through the critical happy path and the primary error path.

---

## 2. Scope

### 2.1 What Changes

| Area | Unit Tests Added | QoL Upgrade |
|------|-----------------|-------------|
| `Connections.tsx` | Save success banner; error display; 4s auto-dismiss; watcher IPC call | ✅ already shipped |
| `ProjectsModule.tsx` | Spinner visibility during IPC; filter passthrough; click→open | Replace "Searching…" text with inline `Loader2` spinner in search row |
| `SystemStatusModule.tsx` | Skeleton on mount; status mapping; refresh re-polls | Skeleton rows before first poll; relative "N min ago" last-checked; `tick` re-renders timestamp only |
| `humanizeAge.ts` (new) | 7 unit tests | Shared pure utility extracted from `IndexStatusBar`'s local `formatRelativeTime` |
| `IndexStatusBar.tsx` | Subscription cleanup (unmount); live count; null when not-configured | Import `humanizeAge` from shared location (replaces local `formatRelativeTime`) |
| Shell / App.tsx | Toast on crawl start; toast on crawl complete | `useIndexingToasts` hook wired in `App.tsx` |
| `fileIndexService.ts` | rootGetter timing; watcher-call side effect via `main.ts` test file | No UI change |
| Playwright E2E | Happy path + error path | N/A |

### 2.2 What Does Not Change

- No new IPC channels
- No database schema changes
- `parseFilename.ts` (44 tests, complete)
- `fileIndexService.ts` core crawl logic
- Sidebar, TitleBar, CommandPalette, router

---

## 3. Track 1 — Unit Gap-Fill + QoL Upgrades

### Task 1 — Connections.tsx unit tests

**File:** `src/renderer/modules/settings/pages/Connections.test.tsx`

Test cases to add (all new — current test file does not cover these):
- Clicking Save calls `storeSet` then `fileIndexReindex` in order
- Success banner `"✓ Saved — indexing started"` appears after save
- Success banner disappears after 4 seconds (use `vi.useFakeTimers()`)
- Error message appears when `storeSet` rejects
- Error message appears when `fileIndexReindex` rejects
- Success banner and error message are mutually exclusive
- Save button shows `"Saving…"` during in-flight IPC
- Save button is re-enabled after save completes

---

### Task 2 — ProjectsModule.tsx: spinner upgrade + missing tests

**Current state:** `ProjectsModule.tsx` has a `loading` boolean state that renders a full-area `"Searching…"` text string while IPC is in-flight. There is no result count badge.

**QoL change — `src/renderer/modules/projects/ProjectsModule.tsx`:**
- Replace the full-area `"Searching…"` text with an inline `Loader2` spinner (Lucide, `animate-spin`, `w-4 h-4`) positioned inside the search input row on the right side
- The `loading` state variable remains — no rename needed
- Debounce fires before IPC, so rapid typing does not thrash the spinner

**Test cases to add — `src/renderer/modules/projects/ProjectsModule.test.tsx`:**
- Spinner element is visible while IPC is in-flight (mock `fileIndexSearch` to hang)
- Spinner disappears after IPC resolves
- Clicking a result calls `fileIndexOpen` with the correct file path
- Search with a non-empty query passes the correct `query` field to `fileIndexSearch`

---

### Task 3 — Shared `humanizeAge` util + SystemStatusModule QoL + tests

**Step A — New shared utility:**

**New file: `src/renderer/shared/utils/humanizeAge.ts`**

Signature: `humanizeAge(ageMs: number): string`

- `ageMs` is a **duration in milliseconds** (i.e., `Date.now() - epochMs`), NOT an epoch timestamp
- `< 60_000` → `"just now"`
- `< 3_600_000` → `"N min ago"` (floor to nearest minute)
- `≥ 3_600_000` → `"N hr ago"` (floor to nearest hour)

**`IndexStatusBar.tsx` update:** Replace the local `formatRelativeTime` function with an import from `humanizeAge.ts`. The existing call site passes `status.lastCrawledMs` (an epoch). Update the call to `humanizeAge(Date.now() - status.lastCrawledMs)` so it passes a duration, matching the new signature.

**Step B — SystemStatusModule QoL changes (`src/renderer/modules/system-status/SystemStatusModule.tsx`):**

1. **Skeleton rows:** Add `isLoading` boolean state, `true` on mount, `false` after first `fileIndexStatus()` resolves. While `isLoading`, render skeleton table rows using `animate-pulse bg-surface-raised h-3 rounded` bars in place of status badge and detail text.

2. **Relative last-checked timestamp:** Replace `lastChecked.toLocaleTimeString()` with `humanizeAge(Date.now() - lastCheckedMs)`. Add a `tick` state (`number`, starts `0`) incremented by a dedicated `setInterval` every 30 seconds inside a `useEffect`. `tick` is included in the JSX rendering path (e.g., as a no-op `key` fragment or inline expression) so React re-renders the humanized string every 30 seconds. **`tick` is ONLY for re-rendering — it does NOT call `fileIndexStatus()` or trigger any IPC activity.** The existing polling logic is separate. `lastCheckedMs` is the timestamp of the most recent `fileIndexStatus()` call (on mount and on Refresh). `humanizeAge(Date.now() - lastCheckedMs)` re-evaluates `Date.now()` on every render, so it correctly shows increasing age between refreshes without `lastCheckedMs` itself needing to change. The displayed age is intentionally anchored to the last actual status poll — it shows how long ago data was fetched, not how long ago the crawl ran.

3. **Status mapping (verify and complete):** Ensure the `IndexStatus → badge` mapping is exhaustive:
   - `idle` (any `fileCount`) → `"Connected"` (green)
   - `crawling` → `"Indexing"` (accent colour) with spinner
   - `error` → `"Unreachable"` (red)
   - `not-configured` → `"Not configured"` (grey)

**Test cases to add — `src/renderer/modules/system-status/SystemStatusModule.test.tsx`:**
- Skeleton rows are shown on mount before first poll resolves
- Skeleton rows are replaced by real rows after first poll resolves
- Status badge shows `"Connected"` when `IndexStatus` is `idle`
- Status badge shows `"Indexing"` when `IndexStatus` is `crawling`
- Status badge shows `"Unreachable"` when `IndexStatus` is `error`
- Status badge shows `"Not configured"` when `IndexStatus` is `not-configured`
- Refresh button triggers a new `fileIndexStatus()` call (assert called twice total: once on mount, once on click)

**Test cases to add — `src/renderer/shared/utils/humanizeAge.test.ts`:**
- `humanizeAge(0)` → `"just now"`
- `humanizeAge(59_999)` → `"just now"`
- `humanizeAge(60_000)` → `"1 min ago"`
- `humanizeAge(90_000)` → `"1 min ago"`
- `humanizeAge(3_599_999)` → `"59 min ago"`
- `humanizeAge(3_600_000)` → `"1 hr ago"`
- `humanizeAge(7_200_000)` → `"2 hr ago"`

---

### Task 4 — IndexStatusBar.tsx: test gap-fill only

**Current state:** `IndexStatusBar.tsx` fully implements live crawl count (subscribes to `onFileIndexProgress`, stores count in `liveCount`, renders `"Indexing… N,NNN files so far"` during crawl). The existing test file covers: null/not-configured; idle file count; crawling spinner + live count; error state.

**Code change in Task 4:** Import `humanizeAge` from `src/renderer/shared/utils/humanizeAge.ts` (removing local `formatRelativeTime`) — this is the call-site update specified in Task 3, Step A. No other code changes.

**Genuine test gap — subscription cleanup:** The existing tests do not verify that the `onFileIndexProgress` cleanup function is called on unmount (i.e., that the returned unsubscribe function is invoked when the component is destroyed). This is the primary gap.

**Test cases to add — `src/renderer/modules/projects/components/IndexStatusBar.test.tsx`:**
- `onFileIndexProgress` cleanup function is called on unmount (mock `onFileIndexProgress` to return a spy; unmount the component; assert spy was called)
- Progress event with count 500 renders `"Indexing… 500 files so far"` while status is `crawling` (if not already covered by existing tests — verify first)

**Note on existing test wording:** The existing `IndexStatusBar.test.tsx` asserts text matching `/minutes ago/` or similar plurals from the current `formatRelativeTime` function. When `humanizeAge` replaces it (singular: `"1 min ago"`), those existing test assertions must be updated to match the new wording. This is in scope for Task 4.

---

### Task 5 — `useIndexingToasts` hook + App.tsx wire

**New file — `src/renderer/shared/hooks/useIndexingToasts.ts`:**

The hook combines two mechanisms:
1. `onFileIndexProgress` subscription — detects crawl start
2. `fileIndexStatus()` polling every 5 seconds — detects crawl completion

**State and refs:**
- `prevStatusRef: MutableRefObject<IndexStatus['status'] | null>` — tracks the previous poll result to detect `crawling → idle` transitions; starts `null`
- `crawlToastFiredRef: MutableRefObject<boolean>` — prevents duplicate "Indexing started" toasts within one crawl cycle; starts `false`

**Logic:**
```
On mount:
  call fileIndexStatus() once → set prevStatusRef.current = result.status
  (this establishes a baseline so no false crawling→idle transition fires on startup)

onFileIndexProgress fires (count > 0):
  if crawlToastFiredRef.current === false:
    fire info toast "Indexing started"
    crawlToastFiredRef.current = true
  NOTE: The poll loop NEVER fires the info toast.
  If the app launches mid-crawl (status already 'crawling' on mount baseline),
  no "Indexing started" toast fires — this is intentional. The toast is only
  triggered by an observed progress event, not by detecting crawling status.

Poll every 5s (fileIndexStatus()):
  if prevStatusRef.current === 'crawling' AND current.status === 'idle':
    fire success toast "Index ready — N,NNN files"  (N,NNN formatted with toLocaleString())
    crawlToastFiredRef.current = false  // reset for next crawl cycle
  prevStatusRef.current = current.status
  NOTE: The poll loop only fires the success (completion) toast, never the info (start) toast.
```

**Mount point:** `useIndexingToasts()` is called in `App.tsx`. The toast system is a pure Zustand store (`useToastStore`) — `addToast` is a store action that can be called from anywhere in or outside the React tree without any ancestor requirement. `ToastContainer` in `Shell.tsx` subscribes to `useToastStore` independently. Therefore `useIndexingToasts` mounted in `App.tsx` (the router root) dispatches toasts that `ToastContainer` in `Shell.tsx` renders correctly. Do **not** move the hook to `Shell.tsx` — `App.tsx` ensures it is always mounted regardless of which route is active.

**Cleanup:** unsubscribe `onFileIndexProgress` and clear polling interval on unmount.

**Test cases — `src/renderer/shared/hooks/useIndexingToasts.test.ts`:**
- Info toast `"Indexing started"` fires when first progress event arrives after `idle` baseline established on mount
- Info toast does not fire twice for the same crawl (second progress event does not fire a second toast)
- Success toast `"Index ready — 4 files"` fires when poll detects `crawling → idle` transition
- Success toast includes the correct file count from the idle status
- No toast fires on mount when baseline status is already `idle` (no transition detected)
- `crawlToastFiredRef` resets to `false` after `crawling → idle` so a second crawl can fire "Indexing started" again

---

### Task 6 — fileIndexService gap-fill test

**`main.ts` IPC handlers are registered as module-level side effects** (`ipcMain.handle(...)` at top level, not inside an exported function). Unit-testing them in isolation would require mocking the entire Electron runtime and is disproportionate to the value. The `startWatcher`-from-reindex behavior is verified indirectly by the E2E happy path in Task 8 (configure root → reindex → search finds files → watcher is implicitly running). No `main.test.ts` is created.

**File — `src/main/fileIndexService.test.ts`:**

Test case to add:
- **rootGetter live reference:** `fileIndexService` stores the `rootGetter` function supplied to `init()` as a module-level variable. `startCrawl()` reads `rootGetter()` synchronously at crawl start — it is a live call, not a snapshot. Test: call `init(':memory:', () => 'pathA', null)`, then call `init(':memory:', () => 'pathB', null)` (replaces the stored rootGetter), then call `reindex()`. Assert that the crawl attempts to walk `'pathB'` (e.g., `crawl_status` becomes `'error'` with an error message referencing `pathB`, since `pathB` does not exist on disk). This confirms that `init()` updates the live reference and `reindex()` uses the current value.

**Do NOT add:**
- Tests for blank-query guard (already covered)
- Tests for stale cleanup (already covered)
- Tests for `getStatus` returning `not-configured` when root empty (already covered)

---

## 4. Track 2 — Playwright E2E Harness

### Task 7 — Setup

**Install:**
```
npm install --save-dev @playwright/test
```

**Add to `package.json` scripts:**
```json
"test:e2e": "playwright test"
```

**`playwright.config.ts` (project root):**
```ts
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  reporter: 'list',
  globalSetup: './e2e/globalSetup.ts',
})
```

**`e2e/globalSetup.ts`:**
```ts
import fs from 'node:fs'
import path from 'node:path'
export default function globalSetup() {
  const mainEntry = path.resolve(__dirname, '../.vite/build/main.js')
  if (!fs.existsSync(mainEntry)) {
    throw new Error(
      `E2E prerequisite missing: ${mainEntry}\n` +
      `Run "npm start" once (then Ctrl+C) to generate the compiled output before running tests.`
    )
  }
}
```

This provides a clear, actionable error instead of a cryptic file-not-found crash when the build output is missing.

**`e2e/fixtures/launchApp.ts`:**

Use `@playwright/test`'s `_electron` import. The project uses `@electron-forge/plugin-vite`, which compiles the main process to `.vite/build/main.js` in development mode (the same output used by `npm start`). This path is confirmed in `forge.config.ts` via the `VitePlugin` with `entry: 'src/main/main.ts'` and `target: 'main'`.

```ts
import { _electron as electron } from '@playwright/test'
import path from 'node:path'

export async function launchApp() {
  const app = await electron.launch({
    args: [path.join(__dirname, '../../.vite/build/main.js')],
  })
  const page = await app.firstWindow()
  return { app, page }
}
```

**Prerequisite:** The compiled output at `.vite/build/main.js` requires `npm start` to have been run at least once (or `npm run package`). Add a note in `e2e/README.md` that `npm start` must be run before `npm run test:e2e` to generate the compiled output. If Playwright is run in CI, add a build step (`electron-forge build`) before the E2E step.

**`e2e/fixtures/testDataDir.ts`:**
```ts
import path from 'node:path'
// Points to the `projects/` subdirectory — PROJ-001 and PROJ-002 live inside it.
// __testdata__/ itself contains only a `projects/` folder; the Connections root
// must be set to __testdata__/projects/ for fileIndexService to discover the project folders.
export const TEST_DATA_ROOT = path.resolve(__dirname, '../../src/main/__testdata__/projects')
```

Test data available:
- `PROJ-001/C-101_IFC_Rev_A.dwg` — matches search `"C-101"`, has drawing number badge `C-101`
- `PROJ-001/S-201_DD.pdf`
- `PROJ-002/Footing_Calc_Rev2.xlsx`
- `PROJ-002/Geotech_Report_Final.pdf`

---

### Task 8 — Happy path E2E spec

**`e2e/happyPath.spec.ts`**

Test: `"full happy path: launch → configure → index → search → open"`

```
1.  launchApp() → shell renders, sidebar visible, TitleBar visible
2.  Click Settings in sidebar
3.  Click "Connections" nav item
4.  Clear root path input, type TEST_DATA_ROOT (absolute path string)
5.  Click Save → assert success banner "✓ Saved — indexing started" visible
6.  Assert info toast "Indexing started" appears (waitFor, max 3s)
7.  Click Projects in sidebar (or Ctrl+Shift+P)
8.  Wait for success toast containing "Index ready" (max 15s)
    NOTE: The test fixture has only 4 files — the crawling state transitions in
    milliseconds and may not be observable as an intermediate step. Do NOT assert
    an intermediate "crawling" state. Assert only the final idle success toast.
9.  Click search input, type "C-101"
10. Wait for results list to contain at least one item (max 5s)
    Selector: `page.locator('[data-testid="search-result-item"]').first()`
    `data-testid="search-result-item"` must be added to each result row element
    in `SearchResults.tsx` as part of Task 8. This is a targeted, non-visual addition.
11. Assert at least one result contains text "C-101" (drawing number badge)
12. Before clicking the result, inject a shell.openPath spy into the main process:
    ```ts
    await app.evaluate(({ shell }) => {
      ;(shell as any).__lastOpenedPath = null
      const orig = shell.openPath
      ;(shell as any).__origOpenPath = orig
      shell.openPath = async (p: string) => {
        ;(shell as any).__lastOpenedPath = p
        return ''  // success, no error string
      }
    })
    ```
    `app.evaluate` executes in the main process Electron context where the `shell`
    module is directly accessible. This replaces `shell.openPath` (called by
    `fileIndexService.openFile` which is invoked by the FILE_INDEX_OPEN IPC handler)
    with a spy that captures the opened path.
    **Why this works:** `fileIndexService.ts` imports `shell` as a module object
    (`import { shell } from 'electron'`) and calls `shell.openPath(filePath)` at
    invocation time — not via a captured destructured reference. Replacing
    `shell.openPath` on the object intercepts the call correctly.
13. Click the first result
14. Read back the captured path:
    ```ts
    const openedPath = await app.evaluate(({ shell }) => (shell as any).__lastOpenedPath)
    expect(openedPath).toContain('C-101_IFC_Rev_A.dwg')
    ```
15. Restore original shell.openPath:
    ```ts
    await app.evaluate(({ shell }) => {
      shell.openPath = (shell as any).__origOpenPath
    })
    ```
```

---

### Task 9 — Error path E2E spec

**`e2e/errorPath.spec.ts`**

Test: `"error path: bad root path → error in Connections + System Status Unreachable"`

```
1.  launchApp()
2.  Navigate to Settings > Connections
3.  Enter path "C:\nonexistent\path\korda-xyz-does-not-exist"
4.  Click Save → assert success banner appears (store write succeeded)
5.  Wait up to 10s for error text to appear in Connections status panel:
    Use page.waitForFunction() or waitForSelector with a retry loop.
    The crawl is async; do NOT use an immediate assertion.
6.  Assert error text is visible in status panel (red text)
7.  Navigate to System Status
8.  Wait up to 8s for File Server row to contain "Unreachable":
    Use page.waitForSelector('[data-testid="file-server-status"]', { text: 'Unreachable' })
    or equivalent. SystemStatusModule calls fileIndexStatus() on mount;
    the crawl error will already be stored in DB meta so this resolves quickly,
    but a waitFor is required — not an immediate assertion.
9.  Assert File Server row contains "Unreachable"
```

**Required code change in Task 9:** Add `data-testid="file-server-status"` to the status badge element (the `<span>` or `<td>` that contains the badge text) in the File Server row of `SystemStatusModule.tsx`. Place the attribute on the innermost element that contains the badge text (`"Connected"`, `"Indexing"`, `"Unreachable"`, `"Not configured"`). This is a targeted, non-visual addition required for reliable E2E selection.

---

## 5. Test Infrastructure Notes

### Fake Timers
Tasks 1 and 5 use `vi.useFakeTimers()`. The existing `test/setup.ts` already configures RTL's `asyncWrapper` with `vi.waitFor` for compatibility.

### Playwright + Electron ABI
Playwright drives the app via Electron's runtime. The `better-sqlite3` ABI mismatch (NODE_MODULE_VERSION 137 vs 145) does not affect E2E tests — the app runs under Electron's ABI. No `npm rebuild` needed before `npm run test:e2e`.

### Test Data
E2E tests use `src/main/__testdata__/`. The 4-file, 2-project fixture is sufficient for verifying search and result rendering. The happy-path crawl completes in under 1 second; intermediate `crawling` state is not reliably observable and must not be asserted.

---

## 6. Task Sequence

| # | Task | Type | Depends on |
|---|------|------|-----------|
| 1 | Connections.tsx unit tests | Unit | — |
| 2 | ProjectsModule spinner upgrade + tests | QoL + Unit | — |
| 3 | humanizeAge util + SystemStatusModule QoL + tests | QoL + Unit | — |
| 4 | IndexStatusBar import humanizeAge + cleanup test | Code + Unit | 3 |
| 5 | useIndexingToasts hook + App.tsx wire + tests | QoL + Unit | — |
| 6 | main.ts + fileIndexService gap-fill tests | Unit | — |
| 7 | Playwright setup (install, config, fixtures, test:e2e script) | E2E infra | 1–6 |
| 8 | Happy path E2E spec | E2E | 7 |
| 9 | Error path E2E spec | E2E | 7 |

Tasks 1–3 and 5–6 are independent and can be parallelised. Task 4 depends on Task 3. Tasks 7–9 are sequential after Tasks 1–6.

---

## 7. Success Criteria

- All existing 155 tests continue to pass
- Tasks 1–6 add ≥ 35 new Vitest test cases, all green
- `npm run test` exits 0
- `npm run test:e2e` exits 0 with happy path and error path both passing
- No TypeScript errors (`tsc --noEmit`)
- UI shows: inline `Loader2` spinner during search; `"Indexing… N files so far"` in status bar during crawl; skeleton rows on System Status mount; relative last-checked timestamps; toasts on crawl start/complete
