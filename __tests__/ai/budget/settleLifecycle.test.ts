import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Settlement and the request lifecycle. Pure: the reservation store and Next's
 * `after()` are mocked. Proves the settlement is handed to the lifecycle (not
 * a detached promise), completes after the caller has moved on, retries only
 * database work, never throws, and is left for the expiry sweep on a final
 * failure.
 */
const store = vi.hoisted(() => ({ reserve: vi.fn(), settle: vi.fn() }))
vi.mock('@/db/aiBudget', () => ({ reserveShadow: store.reserve, settleShadow: store.settle }))
vi.mock('@/config/db', () => ({ db: () => ({ where: () => ({ first: async () => undefined }) }) }))
const lifecycle = vi.hoisted(() => ({ tasks: [] as Promise<unknown>[], inScope: true }))
vi.mock('next/server', () => ({
  after: (task: Promise<unknown>) => {
    if (!lifecycle.inScope) throw new Error('`after` was called outside a request scope')
    lifecycle.tasks.push(task)
  },
}))

import { keepAliveUntilDone, settleShadowAfter } from '@/lib/ai/budget/shadow'

const handle = Promise.resolve({ callId: 'c-1' })
const outcome = {
  outcome: 'success' as const,
  usage: null,
  models: { requested: 'gpt-5.6-sol' },
  verdict: { costUsd: 0.002, costBasis: 'estimated' as const, costNote: 'cache_write_unreported', priceVersion: '2026-10-30' },
}

beforeEach(() => {
  lifecycle.tasks = []
  lifecycle.inScope = true
  store.settle.mockReset()
})
afterEach(() => vi.useRealTimers())

describe('settlement and the request lifecycle', () => {
  it('a fast settlement completes before the caller continues, and is registered with after()', async () => {
    store.settle.mockResolvedValue(true)
    await settleShadowAfter(handle, outcome)
    expect(store.settle).toHaveBeenCalledTimes(1)
    expect(store.settle.mock.calls[0][0]).toMatchObject({ callId: 'c-1', actualUsd: 0.002, costBasis: 'estimated' })
    expect(lifecycle.tasks).toHaveLength(1)
  })

  it('a slow settlement: the caller is released after 250 ms; the lifecycle keeps the work until it completes', async () => {
    let finish!: (v: boolean) => void
    store.settle.mockReturnValue(new Promise<boolean>((r) => (finish = r)))
    const t0 = Date.now()
    await settleShadowAfter(handle, outcome)
    expect(Date.now() - t0).toBeLessThan(1_000)
    expect(lifecycle.tasks).toHaveLength(1)
    let done = false
    void lifecycle.tasks[0].then(() => (done = true))
    await new Promise((r) => setTimeout(r, 10))
    expect(done).toBe(false) // still running after the caller moved on — held by after(), not detached
    finish(true)
    await lifecycle.tasks[0]
    expect(done).toBe(true)
  })

  it('a transient database failure is retried (database work only) and then succeeds', async () => {
    store.settle
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValue(true)
    await settleShadowAfter(handle, outcome)
    await Promise.all(lifecycle.tasks)
    expect(store.settle).toHaveBeenCalledTimes(3)
    // Every attempt is the same idempotent settlement — same callId, same amounts.
    expect(new Set(store.settle.mock.calls.map((c) => JSON.stringify(c[0]))).size).toBe(1)
  })

  it('a permanent failure never throws and leaves the reservation for the expiry sweep', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    store.settle.mockRejectedValue(Object.assign(new Error('down'), { name: 'KnexTimeoutError' }))
    await expect(settleShadowAfter(handle, outcome)).resolves.toBeUndefined()
    await Promise.all(lifecycle.tasks)
    expect(store.settle).toHaveBeenCalledTimes(3)
    const [tag, line] = err.mock.calls.at(-1) as [string, string]
    expect(tag).toBe('[ai-budget]')
    expect(JSON.parse(line)).toMatchObject({ evt: 'settlement_failed', callId: 'c-1', reason: 'db_timeout', attempts: 3 })
    expect(line).not.toContain('down') // the error's message is never logged
    err.mockRestore()
  })

  it('no reservation (flag off or reserve failed): nothing to settle', async () => {
    await settleShadowAfter(Promise.resolve(null), outcome)
    await Promise.all(lifecycle.tasks)
    expect(store.settle).not.toHaveBeenCalled()
  })

  it('outside a request scope there is no lifecycle to extend: reported as detached, the work still runs', async () => {
    lifecycle.inScope = false
    expect(keepAliveUntilDone(Promise.resolve())).toBe('detached')
    store.settle.mockResolvedValue(true)
    await settleShadowAfter(handle, outcome)
    expect(store.settle).toHaveBeenCalledTimes(1)
    lifecycle.inScope = true
    expect(keepAliveUntilDone(Promise.resolve())).toBe('after')
  })
})
