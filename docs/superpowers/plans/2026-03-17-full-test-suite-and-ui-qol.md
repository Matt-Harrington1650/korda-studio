# Full Test Suite & UI QoL Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill all unit test gaps across every module, add polish QoL upgrades (spinner, skeleton, toasts, relative timestamps), and add a Playwright E2E harness that drives the real Electron window through the full happy and error paths.

**Architecture:** Track 1 (Tasks 1–6) adds Vitest unit/RTL tests alongside targeted UI changes — tasks are independent and can be parallelised. Track 2 (Tasks 7–9) adds a Playwright E2E suite that validates the whole app end-to-end; it runs after Track 1 is complete. Every task follows TDD: write failing tests first, implement minimally, verify green.

**Tech Stack:** Electron 41, React 19, TypeScript strict, Vitest + React Testing Library, Playwright + `@playwright/test`, Tailwind CSS v4, Zustand v5, Lucide React icons, better-sqlite3.

---

## File Map

**New files:**
- `src/renderer/shared/utils/humanizeAge.ts` — pure duration→string formatter
- `src/renderer/shared/utils/humanizeAge.test.ts` — 7 unit tests
- `src/renderer/shared/hooks/useIndexingToasts.ts` — crawl start/complete toast hook
- `src/renderer/shared/hooks/useIndexingToasts.test.ts` — 6 unit tests
- `playwright.config.ts` — Playwright configuration
- `e2e/globalSetup.ts` — validates compiled output exists before E2E runs
- `e2e/fixtures/launchApp.ts` — launches real Electron app for E2E
- `e2e/fixtures/testDataDir.ts` — absolute path to test fixtures
- `e2e/README.md` — E2E prerequisites and run instructions
- `e2e/happyPath.spec.ts` — full happy-path E2E test
- `e2e/errorPath.spec.ts` — error-path E2E test

**Modified files:**
- `src/renderer/modules/settings/pages/Connections.test.tsx` — 8 new test cases
- `src/renderer/modules/projects/ProjectsModule.tsx` — replace "Searching…" text with Loader2 spinner
- `src/renderer/modules/projects/ProjectsModule.test.tsx` — 4 new test cases
- `src/renderer/modules/system-status/SystemStatusModule.tsx` — skeleton, tick, humanizeAge, data-testid
- `src/renderer/modules/system-status/SystemStatusModule.test.tsx` — 2 new test cases (skeleton show/hide; existing 7 status-mapping tests are kept as-is)
- `src/renderer/modules/projects/components/IndexStatusBar.tsx` — replace local formatRelativeTime with humanizeAge import
- `src/renderer/modules/projects/components/IndexStatusBar.test.tsx` — update existing assertions + 2 new tests
- `src/renderer/modules/projects/components/SearchResults.tsx` — add data-testid="search-result-item"
- `src/renderer/App.tsx` — wire useIndexingToasts
- `src/main/fileIndexService.test.ts` — 1 new test case
- `package.json` — add `test:e2e` script, install `@playwright/test`

---

## Chunk 1: Unit Tests + QoL (Tasks 1–6)

---

### Task 1: Connections.tsx — missing unit tests

**Files:**
- Modify: `src/renderer/modules/settings/pages/Connections.test.tsx`

The existing test file has 5 tests (renders, disabled, enabled, save-calls, file-count, reindex). We add 8 more covering the new save feedback UI (success banner, error display, fake-timer dismissal).

- [ ] **Step 1.1: Add the 8 new test cases**

Open `src/renderer/modules/settings/pages/Connections.test.tsx`. After the existing `describe` block's last test, add:

```tsx
  it('shows success banner after save', async () => {
    render(<Component />)
    fireEvent.change(screen.getByPlaceholderText(/\\\\SERVER\\projects/i), {
      target: { value: 'C:\\projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(screen.getByText(/✓ Saved/i)).toBeInTheDocument()
    )
  })

  it('success banner disappears after 4 seconds', async () => {
    vi.useFakeTimers()
    render(<Component />)
    fireEvent.change(screen.getByPlaceholderText(/\\\\SERVER\\projects/i), {
      target: { value: 'C:\\projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(screen.getByText(/✓ Saved/i)).toBeInTheDocument())
    act(() => { vi.advanceTimersByTime(4_001) })
    expect(screen.queryByText(/✓ Saved/i)).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('shows error message when storeSet rejects', async () => {
    mockStoreSet.mockRejectedValue(new Error('disk full'))
    render(<Component />)
    fireEvent.change(screen.getByPlaceholderText(/\\\\SERVER\\projects/i), {
      target: { value: 'C:\\projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(screen.getByText(/disk full/i)).toBeInTheDocument()
    )
  })

  it('shows error message when fileIndexReindex rejects', async () => {
    mockFileIndexReindex.mockRejectedValue(new Error('IPC failed'))
    render(<Component />)
    fireEvent.change(screen.getByPlaceholderText(/\\\\SERVER\\projects/i), {
      target: { value: 'C:\\projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(screen.getByText(/IPC failed/i)).toBeInTheDocument()
    )
  })

  it('banner and error are mutually exclusive — no error on success', async () => {
    render(<Component />)
    fireEvent.change(screen.getByPlaceholderText(/\\\\SERVER\\projects/i), {
      target: { value: 'C:\\projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(screen.getByText(/✓ Saved/i)).toBeInTheDocument())
    expect(screen.queryByText(/Error:/i)).not.toBeInTheDocument()
  })

  it('Save button shows "Saving…" while IPC in-flight', async () => {
    // Delay resolution so we can observe the in-flight state
    let resolve!: () => void
    mockStoreSet.mockReturnValue(new Promise<void>((r) => { resolve = r }))
    render(<Component />)
    fireEvent.change(screen.getByPlaceholderText(/\\\\SERVER\\projects/i), {
      target: { value: 'C:\\projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    // Use waitFor — React 19 state updates are async and may not flush synchronously after fireEvent
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /saving/i })).toBeInTheDocument()
    )
    resolve()
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument())
  })

  it('Save button is re-enabled after save completes', async () => {
    render(<Component />)
    fireEvent.change(screen.getByPlaceholderText(/\\\\SERVER\\projects/i), {
      target: { value: 'C:\\projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled()
    )
  })

  it('storeSet is called before fileIndexReindex', async () => {
    const callOrder: string[] = []
    mockStoreSet.mockImplementation(async () => { callOrder.push('storeSet') })
    mockFileIndexReindex.mockImplementation(async () => { callOrder.push('reindex') })
    render(<Component />)
    fireEvent.change(screen.getByPlaceholderText(/\\\\SERVER\\projects/i), {
      target: { value: 'C:\\projects' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(callOrder).toHaveLength(2))
    expect(callOrder).toEqual(['storeSet', 'reindex'])
  })
```

Also add `act` to the import line: `import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'`

- [ ] **Step 1.2: Run the new tests to verify they fail**

```bash
cd "C:\code\Korda studio\korda-studio"
npx vitest run src/renderer/modules/settings/pages/Connections.test.tsx
```

Expected: several tests FAIL (success banner, error display don't exist yet as assertions, but the existing component code already has them — some may pass immediately). Confirm each test runs and the suite identifies itself correctly.

- [ ] **Step 1.3: Run all tests to confirm no regression**

```bash
npx vitest run
```

Expected: all 155 existing tests pass + new tests pass (the component already has the UI from the earlier Connections fix). If any fail, read the error and fix the test assertions.

- [ ] **Step 1.4: Commit**

```bash
git add src/renderer/modules/settings/pages/Connections.test.tsx
git commit -m "test: add Connections save feedback unit tests (banner, error, timer, order)"
```

---

### Task 2: ProjectsModule — Loader2 spinner + missing tests

**Files:**
- Modify: `src/renderer/modules/projects/ProjectsModule.tsx`
- Modify: `src/renderer/modules/projects/ProjectsModule.test.tsx`

The existing tests already cover: `fileIndexOpen` click, `fileIndexSearch` query passthrough, and debounce. We add: spinner visibility test. Then we implement the QoL change.

- [ ] **Step 2.1: Write the failing spinner test**

Add to `src/renderer/modules/projects/ProjectsModule.test.tsx` inside the `describe` block:

```tsx
  it('shows Loader2 spinner while fileIndexSearch is in-flight', async () => {
    let resolveSearch!: (val: never[]) => void
    mockFileIndexSearch.mockReturnValue(new Promise((r) => { resolveSearch = r }))
    vi.useFakeTimers()
    render(<ProjectsModule />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'test' } })
    act(() => { vi.advanceTimersByTime(200) })
    // Spinner should be visible while IPC hangs
    await waitFor(() => {
      // The Loader2 icon renders with the lucide class
      expect(document.querySelector('.lucide-loader-2')).toBeTruthy()
    })
    resolveSearch([])
    vi.useRealTimers()
  })
```

- [ ] **Step 2.2: Run the test to verify it fails**

```bash
npx vitest run src/renderer/modules/projects/ProjectsModule.test.tsx --reporter=verbose
```

Expected: FAIL — `lucide-loader-2` element not found (current code renders text "Searching…" instead).

- [ ] **Step 2.3: Implement the spinner QoL change**

In `src/renderer/modules/projects/ProjectsModule.tsx`:

1. Add `Loader2` to imports: `import { Loader2 } from 'lucide-react'`

2. Replace the search input `<div>` block (lines 73–84) with:

```tsx
      {/* Search input */}
      <div className="px-4 py-3 border-b border-border">
        <div className="relative">
          <input
            ref={searchInputRef}
            role="searchbox"
            type="search"
            value={query}
            onChange={handleQueryChange}
            placeholder="Search files by name, drawing number, or path…"
            className="w-full px-3 py-2 pr-8 text-sm bg-surface-raised border border-border rounded
                       text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent"
          />
          {loading && (
            <Loader2
              size={14}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-text-secondary"
            />
          )}
        </div>
      </div>
```

3. Remove the `loading ?` branch from the content area (lines 99–102):

```tsx
      {/* Content area */}
      <div className="flex-1 overflow-auto">
        {isNotConfigured ? (
          <div className="flex flex-col items-center justify-center h-full text-text-secondary gap-2">
            <p className="text-sm">File server not configured</p>
            <a href="/settings/connections" className="text-xs underline hover:text-text-primary">
              Go to Settings → Connections
            </a>
          </div>
        ) : showSearchHint ? (
          <div className="flex items-center justify-center h-full text-text-secondary">
            <p className="text-sm">Search for files by name, drawing number, or path</p>
          </div>
        ) : results.length === 0 && query.trim() ? (
          <div className="flex items-center justify-center h-full text-text-secondary">
            <p className="text-sm">No files matching "{query}"</p>
          </div>
        ) : (
          <SearchResults results={results} onOpenError={handleOpenError} />
        )}
      </div>
```

Note: The "Searching…" full-area state is removed — the spinner in the input row is the in-flight indicator.

- [ ] **Step 2.4: Run the tests**

```bash
npx vitest run src/renderer/modules/projects/ProjectsModule.test.tsx
```

Expected: all tests PASS including the new spinner test.

- [ ] **Step 2.5: Run full suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 2.6: Commit**

```bash
git add src/renderer/modules/projects/ProjectsModule.tsx src/renderer/modules/projects/ProjectsModule.test.tsx
git commit -m "feat: replace Searching text with inline Loader2 spinner; add spinner test"
```

---

### Task 3: humanizeAge utility + SystemStatusModule QoL + tests

**Files:**
- Create: `src/renderer/shared/utils/humanizeAge.ts`
- Create: `src/renderer/shared/utils/humanizeAge.test.ts`
- Modify: `src/renderer/modules/system-status/SystemStatusModule.tsx`
- Modify: `src/renderer/modules/system-status/SystemStatusModule.test.tsx`

#### Step A: humanizeAge utility (TDD)

- [ ] **Step 3.1: Write humanizeAge tests first**

Create `src/renderer/shared/utils/humanizeAge.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { humanizeAge } from './humanizeAge'

describe('humanizeAge', () => {
  it('returns "just now" for 0ms', () => {
    expect(humanizeAge(0)).toBe('just now')
  })

  it('returns "just now" for 59,999ms', () => {
    expect(humanizeAge(59_999)).toBe('just now')
  })

  it('returns "1 min ago" for exactly 60,000ms', () => {
    expect(humanizeAge(60_000)).toBe('1 min ago')
  })

  it('returns "1 min ago" for 90,000ms', () => {
    expect(humanizeAge(90_000)).toBe('1 min ago')
  })

  it('returns "59 min ago" for 3,599,999ms', () => {
    expect(humanizeAge(3_599_999)).toBe('59 min ago')
  })

  it('returns "1 hr ago" for exactly 3,600,000ms', () => {
    expect(humanizeAge(3_600_000)).toBe('1 hr ago')
  })

  it('returns "2 hr ago" for 7,200,000ms', () => {
    expect(humanizeAge(7_200_000)).toBe('2 hr ago')
  })
})
```

- [ ] **Step 3.2: Run to verify FAIL**

```bash
npx vitest run src/renderer/shared/utils/humanizeAge.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement humanizeAge**

Create `src/renderer/shared/utils/humanizeAge.ts`:

```ts
/**
 * Converts a duration in milliseconds into a human-readable relative string.
 * @param ageMs - duration in ms (i.e. Date.now() - someEpochMs). NOT an epoch.
 */
export function humanizeAge(ageMs: number): string {
  if (ageMs < 60_000) return 'just now'
  const minutes = Math.floor(ageMs / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return `${hours} hr ago`
}
```

- [ ] **Step 3.4: Run humanizeAge tests — verify PASS**

```bash
npx vitest run src/renderer/shared/utils/humanizeAge.test.ts
```

Expected: 7/7 PASS.

#### Step B: SystemStatusModule QoL + tests (TDD)

- [ ] **Step 3.5: Add 2 new skeleton tests to SystemStatusModule.test.tsx**

The existing `src/renderer/modules/system-status/SystemStatusModule.test.tsx` already has 7 tests covering: network row, refresh button, Connected, Indexing, Unreachable, Not Configured, and refresh re-calls. Keep all 7. Add only the 2 skeleton tests inside the existing `describe('SystemStatusModule', ...)` block, before the closing `})`:

```tsx
  it('shows skeleton rows on mount before first poll resolves', () => {
    // mockReturnValue (not mockResolvedValue) so the Promise never settles during this test
    mockFileIndexStatus.mockReturnValue(new Promise(() => {}))
    render(<SystemStatusModule />)
    // Skeleton rows use animate-pulse class — visible immediately on mount
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('replaces skeleton rows with real data after first poll resolves', async () => {
    render(<SystemStatusModule />)
    await waitFor(() => {
      expect(document.querySelector('.animate-pulse')).toBeFalsy()
      expect(screen.getByText('File Server')).toBeInTheDocument()
    })
  })
```

- [ ] **Step 3.6: Run to verify FAIL**

```bash
npx vitest run src/renderer/modules/system-status/SystemStatusModule.test.tsx
```

Expected: skeleton test FAILs (no animate-pulse yet). Status-mapping tests may pass or fail depending on existing code. Note which fail.

- [ ] **Step 3.7: Implement SystemStatusModule QoL changes**

Replace `src/renderer/modules/system-status/SystemStatusModule.tsx` entirely:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import type { IndexStatus } from '../../../shared/ipc-types'
import { humanizeAge } from '../../shared/utils/humanizeAge'

type ServiceStatus = 'connected' | 'unreachable' | 'not-configured' | 'indexing'

interface Service {
  name: string
  status: ServiceStatus
  detail: string
  lastCheckedMs: number
}

const statusColors: Record<ServiceStatus, string> = {
  connected: 'bg-success text-success',
  unreachable: 'bg-error text-error',
  'not-configured': 'bg-text-secondary text-text-secondary',
  indexing: 'bg-accent text-accent',
}

const statusLabels: Record<ServiceStatus, string> = {
  connected: 'Connected',
  unreachable: 'Unreachable',
  'not-configured': 'Not Configured',
  indexing: 'Indexing…',
}

function indexStatusToServiceStatus(s: IndexStatus): { status: ServiceStatus; detail: string } {
  switch (s.status) {
    case 'idle':
      return { status: 'connected', detail: `${s.fileCount.toLocaleString()} files indexed` }
    case 'crawling':
      return { status: 'indexing', detail: `${s.fileCount.toLocaleString()} files…` }
    case 'error':
      return { status: 'unreachable', detail: s.crawlError ?? '' }
    case 'not-configured':
    default:
      return { status: 'not-configured', detail: '' }
  }
}

export default function SystemStatusModule() {
  const [isLoading, setIsLoading] = useState(true)
  const [tick, setTick] = useState(0) // increments every 30s to re-render humanized timestamps
  const [networkStatus, setNetworkStatus] = useState<ServiceStatus>(
    navigator.onLine ? 'connected' : 'unreachable',
  )
  const [fileServerStatus, setFileServerStatus] = useState<ServiceStatus>('not-configured')
  const [fileServerDetail, setFileServerDetail] = useState('')
  const [lastCheckedMs, setLastCheckedMs] = useState(Date.now())

  const refreshFileServer = useCallback(async () => {
    try {
      const s = await window.kordaAPI.fileIndexStatus()
      const { status, detail } = indexStatusToServiceStatus(s)
      setFileServerStatus(status)
      setFileServerDetail(detail)
    } catch {
      setFileServerStatus('unreachable')
      setFileServerDetail('')
    }
    setLastCheckedMs(Date.now())
    setIsLoading(false)
  }, [])

  const refresh = useCallback(() => {
    setNetworkStatus(navigator.onLine ? 'connected' : 'unreachable')
    refreshFileServer()
  }, [refreshFileServer])

  useEffect(() => {
    refreshFileServer()
    const handleOnline = () => setNetworkStatus('connected')
    const handleOffline = () => setNetworkStatus('unreachable')
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [refreshFileServer])

  // Tick every 30s to re-render the humanized "last checked" timestamp
  // Does NOT call fileIndexStatus() — only forces a re-render
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const services: Service[] = [
    { name: 'Network', status: networkStatus, detail: '', lastCheckedMs },
    { name: 'File Server', status: fileServerStatus, detail: fileServerDetail, lastCheckedMs },
    { name: 'AI Services', status: 'not-configured', detail: '', lastCheckedMs },
    { name: 'Backend API', status: 'not-configured', detail: '', lastCheckedMs },
  ]

  // Skeleton row for loading state
  const SkeletonRow = ({ isLast }: { isLast: boolean }) => (
    <tr className={isLast ? '' : 'border-b border-border'}>
      <td className="px-4 py-3"><div className="animate-pulse bg-surface-raised h-3 rounded w-20" /></td>
      <td className="px-4 py-3"><div className="animate-pulse bg-surface-raised h-3 rounded w-16" /></td>
      <td className="px-4 py-3"><div className="animate-pulse bg-surface-raised h-3 rounded w-24" /></td>
      <td className="px-4 py-3"><div className="animate-pulse bg-surface-raised h-3 rounded w-14" /></td>
    </tr>
  )

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">System Status</h1>
        <button
          onClick={refresh}
          aria-label="Refresh status"
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary border border-border rounded hover:bg-white/5 transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-surface-raised">
              <th className="text-left px-4 py-2 text-xs font-medium text-text-secondary uppercase tracking-widest">Service</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-text-secondary uppercase tracking-widest">Status</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-text-secondary uppercase tracking-widest">Detail</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-text-secondary uppercase tracking-widest">Last Checked</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <>
                <SkeletonRow isLast={false} />
                <SkeletonRow isLast={false} />
                <SkeletonRow isLast={false} />
                <SkeletonRow isLast={true} />
              </>
            ) : (
              services.map((service, i) => (
                <tr key={service.name} className={i < services.length - 1 ? 'border-b border-border' : ''}>
                  <td className="px-4 py-3 text-sm text-text-primary">{service.name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span className={`w-1.5 h-1.5 rounded-full ${statusColors[service.status].split(' ')[0]}`} />
                      <span
                        className={statusColors[service.status].split(' ')[1]}
                        {...(service.name === 'File Server' ? { 'data-testid': 'file-server-status' } : {})}
                      >
                        {statusLabels[service.status]}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-text-secondary">{service.detail}</td>
                  <td className="px-4 py-3 text-[11px] text-text-secondary font-mono">
                    {/* tick is read here to trigger re-render every 30s */}
                    {tick >= 0 && humanizeAge(Date.now() - service.lastCheckedMs)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-text-secondary opacity-60">
        Additional service monitoring available in future updates
      </p>
    </div>
  )
}
```

- [ ] **Step 3.8: Run SystemStatusModule tests**

```bash
npx vitest run src/renderer/modules/system-status/SystemStatusModule.test.tsx
```

Expected: all 7 new tests PASS.

- [ ] **Step 3.9: Run full suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 3.10: Commit**

```bash
git add src/renderer/shared/utils/humanizeAge.ts src/renderer/shared/utils/humanizeAge.test.ts src/renderer/modules/system-status/SystemStatusModule.tsx src/renderer/modules/system-status/SystemStatusModule.test.tsx
git commit -m "feat: humanizeAge utility + SystemStatusModule skeleton, relative timestamps, status mapping"
```

---

### Task 4: IndexStatusBar — import humanizeAge + cleanup test

**Files:**
- Modify: `src/renderer/modules/projects/components/IndexStatusBar.tsx`
- Modify: `src/renderer/modules/projects/components/IndexStatusBar.test.tsx`

- [ ] **Step 4.1: Write the cleanup test**

Add to `src/renderer/modules/projects/components/IndexStatusBar.test.tsx` inside the `describe` block:

```tsx
  it('calls the onFileIndexProgress cleanup function on unmount', async () => {
    const unsubscribeSpy = vi.fn()
    mockOnFileIndexProgress.mockReturnValue(unsubscribeSpy)
    mockFileIndexStatus.mockResolvedValue({
      status: 'idle', fileCount: 10, lastCrawledMs: Date.now(),
      rootPath: '\\\\SERVER\\projects', crawlError: null,
    })
    const { unmount } = render(<IndexStatusBar onReindex={mockFileIndexReindex} />)
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalled())
    unmount()
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 4.2: Run to verify it passes (subscription cleanup already implemented)**

```bash
npx vitest run src/renderer/modules/projects/components/IndexStatusBar.test.tsx
```

Expected: all tests PASS including the new cleanup test. If it fails, there is a cleanup bug — investigate and fix `IndexStatusBar.tsx` before proceeding.

- [ ] **Step 4.3: Update IndexStatusBar to use humanizeAge**

In `src/renderer/modules/projects/components/IndexStatusBar.tsx`:

1. Add import at the top: `import { humanizeAge } from '../../../shared/utils/humanizeAge'`

2. Remove the local `formatRelativeTime` function (lines 77–85).

3. Update the call site (line 60) from:
   ```tsx
   ` · updated ${formatRelativeTime(status.lastCrawledMs)}`
   ```
   to:
   ```tsx
   ` · updated ${humanizeAge(Date.now() - status.lastCrawledMs)}`
   ```

- [ ] **Step 4.4: Update the existing test assertion that uses plural wording**

The existing test at line 40 asserts `expect(screen.getByText(/minute/)).toBeInTheDocument()`. The old `formatRelativeTime` returned `"3 minutes ago"` (plural). `humanizeAge` returns `"3 min ago"`. Update the assertion:

```tsx
  // In the 'shows file count and relative time when idle' test:
  expect(screen.getByText(/min ago/)).toBeInTheDocument()
```

- [ ] **Step 4.5: Run IndexStatusBar tests**

```bash
npx vitest run src/renderer/modules/projects/components/IndexStatusBar.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 4.6: Run full suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 4.7: Commit**

```bash
git add src/renderer/modules/projects/components/IndexStatusBar.tsx src/renderer/modules/projects/components/IndexStatusBar.test.tsx
git commit -m "refactor: replace formatRelativeTime with shared humanizeAge; add cleanup test"
```

---

### Task 5: useIndexingToasts hook + App.tsx wire

**Files:**
- Create: `src/renderer/shared/hooks/useIndexingToasts.ts`
- Create: `src/renderer/shared/hooks/useIndexingToasts.test.ts`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 5.1: Write the hook tests first**

Create `src/renderer/shared/hooks/useIndexingToasts.test.ts`:

```tsx
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useIndexingToasts } from './useIndexingToasts'
import { useToastStore } from '@shared/state/toastStore'

const mockFileIndexStatus = vi.fn()
const mockOnFileIndexProgress = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  // Clear toast store between tests
  useToastStore.setState({ toasts: [] })
  vi.stubGlobal('kordaAPI', {
    fileIndexStatus: mockFileIndexStatus,
    onFileIndexProgress: mockOnFileIndexProgress,
  })
  mockOnFileIndexProgress.mockReturnValue(() => {}) // returns unsubscribe fn
})

afterEach(() => {
  vi.useRealTimers()
})

function makeStatus(status: string, fileCount = 0) {
  return { status, fileCount, lastCrawledMs: null, rootPath: '', crawlError: null }
}

describe('useIndexingToasts', () => {
  it('fires info toast "Indexing started" when first progress event arrives after idle baseline', async () => {
    mockFileIndexStatus.mockResolvedValue(makeStatus('idle'))
    let progressCb!: (count: number) => void
    mockOnFileIndexProgress.mockImplementation((cb: (count: number) => void) => {
      progressCb = cb
      return () => {}
    })

    renderHook(() => useIndexingToasts())

    // Wait for mount baseline poll to complete
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(1))

    // Simulate progress event
    act(() => { progressCb(100) })

    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].title).toMatch(/indexing started/i)
    expect(toasts[0].type).toBe('info')
  })

  it('does not fire info toast twice for the same crawl', async () => {
    mockFileIndexStatus.mockResolvedValue(makeStatus('idle'))
    let progressCb!: (count: number) => void
    mockOnFileIndexProgress.mockImplementation((cb: (count: number) => void) => {
      progressCb = cb
      return () => {}
    })

    renderHook(() => useIndexingToasts())
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(1))

    act(() => { progressCb(100) })
    act(() => { progressCb(200) }) // second event in same crawl

    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1) // only one toast
  })

  it('fires success toast "Index ready" when crawling→idle transition detected', async () => {
    // First poll: crawling
    mockFileIndexStatus
      .mockResolvedValueOnce(makeStatus('crawling', 0))   // baseline on mount
      .mockResolvedValueOnce(makeStatus('idle', 42))       // first poll interval

    mockOnFileIndexProgress.mockReturnValue(() => {})

    renderHook(() => useIndexingToasts())
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(1))

    // Advance 5s to trigger the poll interval
    act(() => { vi.advanceTimersByTime(5_001) })
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(2))

    const toasts = useToastStore.getState().toasts
    const successToast = toasts.find((t) => t.type === 'success')
    expect(successToast).toBeDefined()
    expect(successToast!.title).toMatch(/index ready/i)
    expect(successToast!.title).toContain('42')
  })

  it('does not fire any toast when baseline is already idle on mount', async () => {
    mockFileIndexStatus.mockResolvedValue(makeStatus('idle', 100))
    mockOnFileIndexProgress.mockReturnValue(() => {})

    renderHook(() => useIndexingToasts())
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(1))

    // Advance 5s — no crawling→idle transition
    act(() => { vi.advanceTimersByTime(5_001) })
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(2))

    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('resets crawlToastFired after crawling→idle so second crawl can fire again', async () => {
    mockFileIndexStatus
      .mockResolvedValueOnce(makeStatus('idle'))     // baseline
      .mockResolvedValueOnce(makeStatus('idle', 10)) // first poll — no transition

    let progressCb!: (count: number) => void
    mockOnFileIndexProgress.mockImplementation((cb: (count: number) => void) => {
      progressCb = cb
      return () => {}
    })

    const { rerender } = renderHook(() => useIndexingToasts())
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(1))

    // First crawl: progress event → toast fires
    act(() => { progressCb(50) })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    // Simulate crawling→idle transition
    useToastStore.setState({ toasts: [] }) // clear store for clean assertion
    mockFileIndexStatus
      .mockResolvedValueOnce(makeStatus('crawling', 50))
      .mockResolvedValueOnce(makeStatus('idle', 50))
    act(() => { vi.advanceTimersByTime(5_001) })
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalled())
    act(() => { vi.advanceTimersByTime(5_001) })
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts
      expect(toasts.some((t) => t.type === 'success')).toBe(true)
    })

    // After reset, a second progress event should fire info toast again
    useToastStore.setState({ toasts: [] })
    rerender()
    act(() => { progressCb(10) })
    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.type === 'info')).toBe(true)
    )
  })

  it('cleans up onFileIndexProgress subscription and poll interval on unmount', async () => {
    const unsubscribeSpy = vi.fn()
    mockOnFileIndexProgress.mockReturnValue(unsubscribeSpy)
    mockFileIndexStatus.mockResolvedValue(makeStatus('idle'))

    const { unmount } = renderHook(() => useIndexingToasts())
    await waitFor(() => expect(mockFileIndexStatus).toHaveBeenCalledTimes(1))
    unmount()

    expect(unsubscribeSpy).toHaveBeenCalledTimes(1)
    // Advance time — no more fileIndexStatus calls after unmount
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(mockFileIndexStatus).toHaveBeenCalledTimes(1) // still just 1 (baseline only)
  })
})
```

- [ ] **Step 5.2: Run tests to verify FAIL**

```bash
npx vitest run src/renderer/shared/hooks/useIndexingToasts.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5.3: Implement useIndexingToasts**

Create `src/renderer/shared/hooks/useIndexingToasts.ts`:

```ts
import { useEffect, useRef } from 'react'
import { useToastStore } from '@shared/state/toastStore'
import type { IndexStatus } from '../../../shared/ipc-types'

export function useIndexingToasts(): void {
  const addToast = useToastStore((s) => s.addToast)
  const prevStatusRef = useRef<IndexStatus['status'] | null>(null)
  const crawlToastFiredRef = useRef(false)

  useEffect(() => {
    // Establish baseline on mount — prevents false crawling→idle toast on startup
    window.kordaAPI.fileIndexStatus().then((s) => {
      prevStatusRef.current = s.status
    }).catch(() => {})

    // Subscribe to progress events — detects crawl start
    const unsubscribe = window.kordaAPI.onFileIndexProgress((count) => {
      if (count > 0 && !crawlToastFiredRef.current) {
        addToast({ title: 'Indexing started', type: 'info' })
        crawlToastFiredRef.current = true
      }
    })

    // Poll every 5s — detects crawl completion
    const intervalId = setInterval(async () => {
      try {
        const current = await window.kordaAPI.fileIndexStatus()
        if (prevStatusRef.current === 'crawling' && current.status === 'idle') {
          addToast({
            title: `Index ready — ${current.fileCount.toLocaleString()} files`,
            type: 'success',
          })
          crawlToastFiredRef.current = false // reset for next crawl
        }
        prevStatusRef.current = current.status
      } catch {
        // ignore poll errors
      }
    }, 5_000)

    return () => {
      unsubscribe()
      clearInterval(intervalId)
    }
  }, [addToast])
}
```

- [ ] **Step 5.4: Run the hook tests**

```bash
npx vitest run src/renderer/shared/hooks/useIndexingToasts.test.ts
```

Expected: all 6 tests PASS. If any fail, read the error carefully — fake timer interactions with async code can be tricky. Common fix: wrap `vi.advanceTimersByTime` in `act()` and follow with `await waitFor(...)`.

- [ ] **Step 5.5: Wire useIndexingToasts into App.tsx**

Replace `src/renderer/App.tsx` entirely:

```tsx
import { RouterProvider } from 'react-router'
import { router } from './router'
import { useIndexingToasts } from './shared/hooks/useIndexingToasts'

function AppInner() {
  useIndexingToasts()
  return <RouterProvider router={router} />
}

export default function App() {
  return <AppInner />
}
```

Note: `useIndexingToasts` must be called inside a component (React hook rules). `AppInner` wraps it so `App` stays as the default export.

- [ ] **Step 5.6: Run full suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5.7: Commit**

```bash
git add src/renderer/shared/hooks/useIndexingToasts.ts src/renderer/shared/hooks/useIndexingToasts.test.ts src/renderer/App.tsx
git commit -m "feat: useIndexingToasts hook — info/success toasts on crawl start/complete; wire into App"
```

---

### Task 6: fileIndexService — rootGetter live-reference test

**Files:**
- Modify: `src/main/fileIndexService.test.ts`

- [ ] **Step 6.1: Write the rootGetter timing test**

Add to `src/main/fileIndexService.test.ts` — find the describe block for crawling/reindex behavior and add:

```ts
  it('rootGetter is read at crawl time, not captured at init() call time', async () => {
    // Init with one rootGetter, then re-init with another before reindex
    fileIndexService.init(':memory:', () => 'C:\\path-A', null)
    // Re-init: overwrites the stored rootGetter with one returning path-B (which does not exist)
    fileIndexService.init(':memory:', () => 'C:\\path-B-nonexistent-xyz', null)

    fileIndexService.reindex()

    // Wait for crawl to attempt and fail (path-B does not exist on disk)
    await vi.waitFor(async () => {
      const status = fileIndexService.getStatus()
      expect(['error', 'idle']).toContain(status.status)
    }, { timeout: 3000 })

    const status = fileIndexService.getStatus()
    // The crawl_error or root_path should reference path-B, not path-A
    // (If root_path is stored in meta, it will be path-B)
    expect(status.rootPath ?? status.crawlError ?? '').toContain('path-B-nonexistent')
  })
```

- [ ] **Step 6.2: Run the test**

```bash
npx vitest run src/main/fileIndexService.test.ts --reporter=verbose
```

Expected: the new test PASSES (rootGetter is already a live reference in the current implementation — this test confirms it stays that way).

- [ ] **Step 6.3: Run full suite**

```bash
npx vitest run
```

Expected: all tests pass. Count the total — should be ≥190 (155 + new tests from tasks 1–6).

- [ ] **Step 6.4: Commit**

```bash
git add src/main/fileIndexService.test.ts
git commit -m "test: add rootGetter live-reference test to fileIndexService"
```

---

## Chunk 2: Playwright E2E (Tasks 7–9)

---

### Task 7: Playwright setup

**Files:**
- `package.json` — add devDependency + script
- `playwright.config.ts` (new)
- `e2e/globalSetup.ts` (new)
- `e2e/fixtures/launchApp.ts` (new)
- `e2e/fixtures/testDataDir.ts` (new)
- `e2e/README.md` (new)

- [ ] **Step 7.1: Install @playwright/test**

```bash
cd "C:\code\Korda studio\korda-studio"
npm install --save-dev @playwright/test
```

Expected: `@playwright/test` added to `node_modules` and `package.json` devDependencies.

- [ ] **Step 7.2: Add test:e2e script to package.json**

In `package.json`, add to the `"scripts"` object:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 7.3: Create playwright.config.ts**

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  reporter: 'list',
  globalSetup: './e2e/globalSetup.ts',
})
```

- [ ] **Step 7.4: Create e2e/globalSetup.ts**

```ts
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
```

- [ ] **Step 7.5: Create e2e/fixtures/launchApp.ts**

```ts
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
```

- [ ] **Step 7.6: Create e2e/fixtures/testDataDir.ts**

```ts
import path from 'node:path'

// Points to the projects/ subdirectory — PROJ-001 and PROJ-002 live inside it.
// __testdata__/ itself contains only a `projects/` folder.
// Set this as the Connections root so fileIndexService discovers project folders.
export const TEST_DATA_ROOT = path.resolve(
  __dirname,
  '../../src/main/__testdata__/projects'
)
```

- [ ] **Step 7.7: Create e2e/README.md**

```md
# E2E Tests

## Prerequisites

E2E tests drive the real Electron app. The compiled main entry (`.vite/build/main.js`)
must exist before running tests.

**Generate it:**
```
npm start
# Wait for the app window to open, then press Ctrl+C
```

## Running

```
npm run test:e2e
```

## Test data

Tests use `src/main/__testdata__/projects/` which contains:
- `PROJ-001/C-101_IFC_Rev_A.dwg`
- `PROJ-001/S-201_DD.pdf`
- `PROJ-002/Footing_Calc_Rev2.xlsx`
- `PROJ-002/Geotech_Report_Final.pdf`
```

- [ ] **Step 7.8: Verify globalSetup catches missing build**

```bash
npm run test:e2e
```

If `.vite/build/main.js` doesn't exist, expected output:
```
Error: E2E prerequisite missing: ..\.vite\build\main.js
Run "npm start" once (then Ctrl+C after the app opens) ...
```

If the file exists from a prior `npm start`, the tests will attempt to run and fail (no test files yet) — that's fine.

- [ ] **Step 7.9: Commit**

```bash
git add package.json playwright.config.ts e2e/
git commit -m "feat: add Playwright E2E harness — config, fixtures, globalSetup, README"
```

---

### Task 8: Happy-path E2E spec

**Files:**
- Create: `e2e/happyPath.spec.ts`
- Modify: `src/renderer/modules/projects/components/SearchResults.tsx` — add `data-testid="search-result-item"`

- [ ] **Step 8.1: Add data-testid to SearchResults**

In `src/renderer/modules/projects/components/SearchResults.tsx`, on the `<li>` element (line 64), add `data-testid="search-result-item"`:

```tsx
          <li
            key={entry.path}
            data-testid="search-result-item"
            onClick={() => handleOpen(entry)}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-raised cursor-pointer group"
            role="listitem"
            aria-label={entry.name}
          >
```

- [ ] **Step 8.2: Create e2e/happyPath.spec.ts**

```ts
import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './fixtures/launchApp'
import { TEST_DATA_ROOT } from './fixtures/testDataDir'

test.describe('Happy path', () => {
  test('launch → configure → index → search → open', async () => {
    const { app, page } = await launchApp()

    try {
      // 1. Shell is visible
      await expect(page.locator('nav, [role="navigation"]').first()).toBeVisible({ timeout: 5_000 })

      // 2. Navigate to Settings
      await page.click('[aria-label="Settings"], a[href*="settings"]')
      await page.waitForURL(/settings/, { timeout: 5_000 })

      // 3. Click Connections nav item
      await page.click('text=Connections')
      await expect(page.locator('text=File Server')).toBeVisible({ timeout: 3_000 })

      // 4. Enter the test data root path
      const input = page.locator('#root-path')
      await input.fill('')
      await input.fill(TEST_DATA_ROOT)

      // 5. Click Save
      await page.click('button:has-text("Save")')

      // 6. Assert success banner
      await expect(page.locator('text=✓ Saved')).toBeVisible({ timeout: 5_000 })

      // 7. Assert info toast "Indexing started"
      await expect(page.locator('text=Indexing started')).toBeVisible({ timeout: 5_000 })

      // 8. Navigate to Projects
      await page.click('[aria-label="Projects"], a[href*="projects"]')
      await page.waitForURL(/projects/, { timeout: 5_000 })

      // 9. Wait for success toast "Index ready" — crawl completes fast on 4-file fixture
      // Do NOT assert intermediate "crawling" state — it transitions in <1s
      await expect(page.locator('text=Index ready')).toBeVisible({ timeout: 15_000 })

      // 10. Search for C-101
      const searchBox = page.locator('[role="searchbox"]')
      await searchBox.click()
      await searchBox.fill('C-101')

      // 11. Wait for results
      const firstResult = page.locator('[data-testid="search-result-item"]').first()
      await expect(firstResult).toBeVisible({ timeout: 5_000 })

      // 12. Assert drawing number badge in the result
      await expect(page.locator('[data-testid="search-result-item"] >> text=C-101').first()).toBeVisible()

      // 13. Inject shell.openPath spy into main process before clicking
      await app.evaluate(({ shell }) => {
        ;(shell as any).__lastOpenedPath = null
        const orig = shell.openPath
        ;(shell as any).__origOpenPath = orig
        shell.openPath = async (p: string) => {
          ;(shell as any).__lastOpenedPath = p
          return '' // empty string = success
        }
      })

      // 14. Click the first result
      await firstResult.click()

      // 15. Verify shell.openPath was called with the correct file
      await page.waitForTimeout(500) // allow IPC round-trip
      const openedPath = await app.evaluate(({ shell }) => (shell as any).__lastOpenedPath as string | null)
      expect(openedPath).toBeTruthy()
      expect(openedPath!).toContain('C-101_IFC_Rev_A.dwg')

      // 16. Restore original shell.openPath
      await app.evaluate(({ shell }) => {
        shell.openPath = (shell as any).__origOpenPath
      })

    } finally {
      await closeApp({ app, page })
    }
  })
})
```

- [ ] **Step 8.3: Run the happy-path test**

First ensure the compiled app is available (run `npm start` then Ctrl+C if needed).

```bash
npm run test:e2e -- --grep "Happy path"
```

Expected: test PASSES end-to-end. If it fails:
- Check each step's error message carefully
- Common issues: selectors wrong (adjust aria-label or href patterns to match actual sidebar links), toast not appearing (check useIndexingToasts hook is wired), search not finding results (check TEST_DATA_ROOT points to the right directory)

- [ ] **Step 8.4: Commit**

```bash
git add src/renderer/modules/projects/components/SearchResults.tsx e2e/happyPath.spec.ts
git commit -m "feat: E2E happy path — launch→configure→index→search→open"
```

---

### Task 9: Error-path E2E spec

**Files:**
- Create: `e2e/errorPath.spec.ts`
- `data-testid="file-server-status"` already added to SystemStatusModule in Task 3

- [ ] **Step 9.1: Create e2e/errorPath.spec.ts**

```ts
import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './fixtures/launchApp'

const BAD_PATH = 'C:\\nonexistent\\path\\korda-xyz-does-not-exist'

test.describe('Error path', () => {
  test('bad root path → error in Connections + Unreachable in System Status', async () => {
    const { app, page } = await launchApp()

    try {
      // 1. Navigate to Settings > Connections
      await page.click('[aria-label="Settings"], a[href*="settings"]')
      await page.waitForURL(/settings/, { timeout: 5_000 })
      await page.click('text=Connections')
      await expect(page.locator('text=File Server')).toBeVisible({ timeout: 3_000 })

      // 2. Enter a path that does not exist
      const input = page.locator('#root-path')
      await input.fill('')
      await input.fill(BAD_PATH)

      // 3. Click Save — store write should succeed
      await page.click('button:has-text("Save")')
      await expect(page.locator('text=✓ Saved')).toBeVisible({ timeout: 5_000 })

      // 4. Wait for error text to appear in the status panel
      // The crawl is async — do NOT assert immediately; poll with waitFor
      await expect(
        page.locator('.text-red-400, [class*="text-error"]').first()
      ).toBeVisible({ timeout: 10_000 })

      // 5. Navigate to System Status
      await page.click('[aria-label="System Status"], a[href*="status"]')
      await page.waitForURL(/status/, { timeout: 5_000 })

      // 6. Wait for File Server row to show Unreachable
      // SystemStatusModule calls fileIndexStatus() on mount — crawl error is already in DB meta
      await expect(
        page.locator('[data-testid="file-server-status"]')
      ).toHaveText(/unreachable/i, { timeout: 8_000 })

    } finally {
      await closeApp({ app, page })
    }
  })
})
```

- [ ] **Step 9.2: Run the error-path test**

```bash
npm run test:e2e -- --grep "Error path"
```

Expected: test PASSES. If the error text selector doesn't match, inspect the rendered Connections page in a headed run:

```bash
npx playwright test --headed --grep "Error path"
```

Adjust the selector to match the actual red error text element (e.g., use `page.locator('text=Error:')` or the specific element).

- [ ] **Step 9.3: Run the full E2E suite**

```bash
npm run test:e2e
```

Expected: both happy path and error path PASS.

- [ ] **Step 9.4: Run the full Vitest suite one final time**

```bash
npx vitest run
```

Expected: all ≥190 tests PASS (155 original + ≥35 new).

- [ ] **Step 9.5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 9.6: Final commit**

```bash
git add e2e/errorPath.spec.ts
git commit -m "feat: E2E error path — bad root→Connections error panel→System Status Unreachable"
```

---

## Verification Checklist

Before calling this done:

- [ ] `npx vitest run` → exits 0, ≥190 tests
- [ ] `npm run test:e2e` → exits 0, 2 tests pass
- [ ] `npx tsc --noEmit` → exits 0
- [ ] App running: search input shows Loader2 spinner while typing (not "Searching…" text)
- [ ] App running: System Status shows skeleton rows on first load before data arrives
- [ ] App running: System Status shows "just now" / "N min ago" in Last Checked column
- [ ] App running: "Indexing started" info toast fires when indexing begins
- [ ] App running: "Index ready — N files" success toast fires when indexing completes
- [ ] App running: IndexStatusBar shows "Indexing… N,NNN files so far" during crawl
