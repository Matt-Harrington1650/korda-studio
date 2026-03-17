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
| `ProjectsModule.tsx` | Search-in-flight spinner state; filter passthrough; click→open | Search spinner while IPC in-flight |
| `SystemStatusModule.tsx` | idle→connected mapping; crawling→indexing; error→unreachable; refresh re-polls | Skeleton on mount; real-time last-checked humanizer |
| `IndexStatusBar.tsx` | Live count from `onFileIndexProgress`; crawl→idle transition | Show `"Indexing… N files so far"` from raw progress events |
| Shell / App.tsx | Toast fires on crawl start; toast fires on crawl complete | `useIndexingToasts` hook wired in `App.tsx` |
| `fileIndexService.ts` | Watcher called from `FILE_INDEX_REINDEX` handler; blank-query guard; stale cleanup math | No UI change — test gap-fill only |
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

Test cases to add:
- Clicking Save calls `storeSet` then `fileIndexReindex` in order
- Success banner `"✓ Saved — indexing started"` appears after save
- Success banner disappears after 4 seconds (use fake timers)
- Error message appears when `storeSet` rejects
- Error message appears when `fileIndexReindex` rejects
- Banner and error are mutually exclusive
- Save button shows `"Saving…"` during in-flight IPC
- Save button is disabled while saving

---

### Task 2 — ProjectsModule.tsx: spinner + missing tests

**QoL change — `src/renderer/modules/projects/ProjectsModule.tsx`:**
- Add `isSearching: boolean` state
- Set `true` immediately before `fileIndexSearch` IPC call; set `false` in `finally`
- Render a spinner (Lucide `Loader2` with `animate-spin`) in place of the result count badge while `isSearching` is true
- Debounce fires before IPC, so rapid typing does not thrash the spinner

**Test cases to add — `src/renderer/modules/projects/ProjectsModule.test.tsx`:**
- Spinner is visible while IPC is in-flight
- Spinner is gone after IPC resolves
- Clicking a result calls `fileIndexOpen` with the correct file path
- Search with a non-empty query passes `query` to `fileIndexSearch`
- Result count badge shows correct count after search resolves

---

### Task 3 — SystemStatusModule.tsx: skeleton + humanizer + missing tests

**QoL changes — `src/renderer/modules/system-status/SystemStatusModule.tsx`:**
- On mount, before the first poll resolves, render skeleton rows: grey animated bars in place of status badge and detail text. Use Tailwind `animate-pulse bg-surface-raised` bars.
- Last-checked column: replace static timestamp with a humanized relative string (`"just now"`, `"2 min ago"`, `"1 hr ago"`). Update every 30s via `setInterval`. No external library — implement a small local `humanizeAge(ms: number): string` pure function.
- `humanizeAge` lives in `src/renderer/modules/system-status/humanizeAge.ts` (isolated, easy to test)

**Test cases to add:**
- Skeleton rows are shown on mount before first poll
- Skeleton rows are replaced by real rows after poll resolves
- `humanizeAge(0)` → `"just now"`
- `humanizeAge(90_000)` → `"1 min ago"`
- `humanizeAge(3_600_000)` → `"1 hr ago"`
- Status badge shows `"Connected"` when IndexStatus is `idle` with `fileCount > 0`
- Status badge shows `"Indexing"` when IndexStatus is `crawling`
- Status badge shows `"Unreachable"` when IndexStatus is `error`
- Refresh button triggers a new `fileIndexStatus()` call

---

### Task 4 — IndexStatusBar.tsx: live crawl count + missing tests

**QoL change — `src/renderer/modules/projects/components/IndexStatusBar.tsx`:**
- During crawl, `onFileIndexProgress` events carry a raw file count. Currently these events just trigger a re-poll.
- Change: store the latest progress count in local state (`progressCount`). While `status.status === 'crawling'`, display `"Indexing… N,NNN files so far"` using `progressCount` directly — no additional IPC round-trip needed.
- When crawl transitions to `idle`, clear `progressCount` and show final file count from `status.fileCount`.

**Test cases to add — `src/renderer/modules/projects/components/IndexStatusBar.test.tsx`:**
- Renders `null` when status is `not-configured`
- Shows `"Indexing… 500 files so far"` when status is `crawling` and progress event fires with count 500
- Shows final file count when status transitions to `idle`
- Calls `onFileIndexProgress` subscriber on mount and cleans up on unmount

---

### Task 5 — Shell: useIndexingToasts hook

**New file — `src/renderer/shared/hooks/useIndexingToasts.ts`:**

```
Purpose: Subscribe to FILE_INDEX_PROGRESS and fileIndexStatus polling.
- On first progress event where count > 0 (and was previously idle/not-configured): fire info toast "Indexing started"
- When status transitions from crawling → idle: fire success toast "Index ready — N,NNN files"
- Only fires once per crawl cycle (guard with a ref)
- Cleanup: unsubscribes from onFileIndexProgress on unmount
```

**Wired in `App.tsx`:** `useIndexingToasts()` called at app root so it fires regardless of active page.

**Test cases — `src/renderer/shared/hooks/useIndexingToasts.test.ts`:**
- Info toast fires when first progress event arrives after idle state
- Info toast does not fire twice for the same crawl
- Success toast fires when status transitions crawling → idle
- Success toast includes correct file count
- No toast fires if status is already idle on mount (app restart with stale index)

---

### Task 6 — fileIndexService.ts unit gap-fill

**Test cases to add — `src/main/fileIndexService.test.ts`:**
- `search()` returns `[]` when query is blank string
- `search()` returns `[]` when query is whitespace-only
- Stale file cleanup: files with `indexed_at < crawlStartMs` are deleted after crawl
- `reindex()` followed by `startCrawl()` — root is read from `rootGetter` at crawl time (not at reindex call time)
- `getStatus()` returns `not-configured` when root is empty and DB has no `root_path` meta

---

## 4. Track 2 — Playwright E2E Harness

### Task 7 — Setup

**Install:**
```
npm install --save-dev @playwright/test
```

**New file — `playwright.config.ts` (project root):**
- `testDir: './e2e'`
- `timeout: 30_000` (crawl can be slow on first run)
- `reporter: 'list'`
- No browser projects — Electron only

**New file — `e2e/fixtures/launchApp.ts`:**
- Exports a `launchApp()` function using `playwright`'s `_electron` import
- Points at `electron-forge`'s compiled main entry (`out/main/main.js` or via `MAIN_WINDOW_VITE_DEV_SERVER_URL`)
- Returns `{ app: ElectronApplication, page: Page }`
- Tears down `app.close()` after each test

**New file — `e2e/fixtures/testDataDir.ts`:**
- Re-uses `src/main/__testdata__/` fixture directory (already contains PROJ-001, PROJ-002 with real files)
- Exports `TEST_DATA_ROOT` constant (absolute path)

**`package.json` script:**
```json
"test:e2e": "playwright test"
```

---

### Task 8 — Happy path E2E spec

**New file — `e2e/happyPath.spec.ts`**

Test: `"full happy path: launch → configure → index → search → open"`

Steps:
1. Launch app — shell renders, sidebar visible, TitleBar visible
2. Click Settings in sidebar → Settings page loads
3. Click Connections nav item → Connections page loads
4. Clear root path input, type `TEST_DATA_ROOT`
5. Click Save → success banner `"✓ Saved — indexing started"` appears
6. Info toast `"Indexing started"` appears
7. Navigate to Projects (Ctrl+Shift+P or sidebar click)
8. Wait for `IndexStatusBar` to show crawling state
9. Wait for `IndexStatusBar` to transition to idle (max 15s)
10. Success toast `"Index ready — N files"` appears
11. Type `"C-101"` in search input
12. Wait for results — at least one result with drawing number badge `C-101`
13. Click the result → `fileIndexOpen` IPC fires (verify via `app.evaluate`)

---

### Task 9 — Error path E2E spec

**New file — `e2e/errorPath.spec.ts`**

Test: `"error path: bad root path → error shown in Connections and System Status"`

Steps:
1. Launch app
2. Navigate to Settings > Connections
3. Enter a path that does not exist (`C:\nonexistent\path\xyz`)
4. Click Save → success banner appears (store saved OK)
5. Wait up to 10s for crawl to fail
6. Status section shows error text (red) containing the path or error message
7. Navigate to System Status
8. File Server row shows `"Unreachable"` badge

---

## 5. Test Infrastructure Notes

### Fake Timers
Tasks 1 and 5 use fake timers (`vi.useFakeTimers()`). The existing `test/setup.ts` already configures RTL's `asyncWrapper` with `vi.waitFor` for compatibility.

### Playwright + Electron ABI
Playwright drives the app via `electron-forge start` output. The `better-sqlite3` ABI mismatch (NODE_MODULE_VERSION 137 vs 145) does not affect E2E tests — the app runs under Electron's ABI, not Node's.

### Test Data
E2E tests use the existing `src/main/__testdata__/` fixture directory:
- `PROJ-001/C-101_IFC_Rev_A.dwg`
- `PROJ-001/S-201_DD.pdf`
- `PROJ-002/Footing_Calc_Rev2.xlsx`
- `PROJ-002/Geotech_Report_Final.pdf`

---

## 6. Task Sequence

| # | Task | Type | Depends on |
|---|------|------|-----------|
| 1 | Connections.tsx unit tests | Unit | — |
| 2 | ProjectsModule spinner + tests | QoL + Unit | — |
| 3 | SystemStatusModule skeleton + humanizer + tests | QoL + Unit | — |
| 4 | IndexStatusBar live count + tests | QoL + Unit | — |
| 5 | useIndexingToasts hook + App.tsx wire + tests | QoL + Unit | — |
| 6 | fileIndexService.ts gap-fill tests | Unit | — |
| 7 | Playwright setup (install, config, fixtures) | E2E infra | 1–6 |
| 8 | Happy path E2E spec | E2E | 7 |
| 9 | Error path E2E spec | E2E | 7 |

Tasks 1–6 are independent and can be parallelised. Tasks 7–9 are sequential.

---

## 7. Success Criteria

- All existing 155 tests continue to pass
- Tasks 1–6 add ≥ 35 new Vitest test cases, all green
- `npm run test` exits 0
- `npm run test:e2e` exits 0 with happy path and error path both passing
- No TypeScript errors (`tsc --noEmit`)
- UI shows a spinner during search, live count during crawl, skeleton on System Status mount, and toasts on crawl start/complete
