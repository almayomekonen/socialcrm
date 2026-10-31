import { describe, expect, it, vi } from 'vitest'
import { LeaseLostError, leaseGuard } from '@/lib/inbox/autoresponse/jobLease'

/** Once the heartbeat has seen the lease lost, no further AI work starts for that job. Pure. */
describe('leaseGuard', () => {
  it('passes calls through while the lease is held', async () => {
    const fn = vi.fn(async (x: number) => x * 2)
    expect(await leaseGuard(fn, 1, () => false)(21)).toBe(42)
    expect(fn).toHaveBeenCalledWith(21)
  })

  it('refuses to start the work once the lease is lost, without calling it', async () => {
    const fn = vi.fn(async () => 'reply')
    await expect(leaseGuard(fn, 7, () => true)()).rejects.toBeInstanceOf(LeaseLostError)
    expect(fn).not.toHaveBeenCalled()
  })

  it('reads the flag at call time (a loss seen mid-run stops the next call)', async () => {
    let lost = false
    const fn = vi.fn(async () => 'ok')
    const guarded = leaseGuard(fn, 3, () => lost)
    await guarded()
    lost = true
    await expect(guarded()).rejects.toBeInstanceOf(LeaseLostError)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
