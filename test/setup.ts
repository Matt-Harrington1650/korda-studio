import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { vi } from 'vitest'

// When fake timers are active, waitFor's internal polling (setInterval) is
// also faked. This asyncWrapper advances fake timers before each poll so that
// waitFor can still resolve within a test that uses vi.useFakeTimers().
configure({
  asyncWrapper: async (cb) => {
    let result: unknown
    await vi.waitFor(async () => {
      result = await cb()
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result as any
  },
})
