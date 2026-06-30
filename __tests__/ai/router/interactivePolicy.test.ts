import { describe, it, expect } from 'vitest'
import { attemptBudget, skipRetryOnTimeout, MIN_ATTEMPT_MS } from '@/lib/ai/router/interactivePolicy'
import type { TaskConfig } from '@/lib/ai/tasks'

const interactive: TaskConfig = { role: 'primary', maxOutputTokens: 700, timeoutMs: 7_000, retryOnSameProvider: 1, deadlineMs: 9_000, failFastOnTimeout: true }
const legacy: TaskConfig = { role: 'primary', maxOutputTokens: 700, timeoutMs: 12_000, retryOnSameProvider: 1 }

describe('Interactive Router Policy — attemptBudget', () => {
  it('clamps the per-attempt timeout to the remaining global budget', () => {
    // 5s already elapsed of a 9s budget → only 4s left, less than the 7s per-attempt cap.
    const b = attemptBudget(interactive, 0, 5_000)
    expect(b.stop).toBe(false)
    expect(b.timeoutMs).toBe(4_000)
  })

  it('uses the per-attempt timeout when ample budget remains', () => {
    const b = attemptBudget(interactive, 0, 0)
    expect(b.timeoutMs).toBe(7_000) // min(7000, 9000)
  })

  it('stops once the wall-clock budget is effectively spent', () => {
    const b = attemptBudget(interactive, 0, 9_000 - MIN_ATTEMPT_MS)
    expect(b.stop).toBe(true)
  })

  it('is a no-op for legacy tasks: never stops, per-attempt timeout unchanged', () => {
    const b = attemptBudget(legacy, 0, 999_999)
    expect(b.stop).toBe(false)
    expect(b.timeoutMs).toBe(12_000)
  })
})

describe('Interactive Router Policy — skipRetryOnTimeout', () => {
  it('skips same-provider retry on timeout for interactive tasks', () => {
    expect(skipRetryOnTimeout(interactive, 'timeout')).toBe(true)
  })

  it('still retries non-timeout errors (transient)', () => {
    expect(skipRetryOnTimeout(interactive, 'server-error')).toBe(false)
  })

  it('never changes legacy retry behavior', () => {
    expect(skipRetryOnTimeout(legacy, 'timeout')).toBe(false)
  })
})
