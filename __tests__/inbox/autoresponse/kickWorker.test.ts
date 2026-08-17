import { describe, expect, it, vi } from 'vitest'
import { IRE_KICK_MAX_WAIT_MS, ireKickWaitMs, runAutoResponseKick } from '@/lib/inbox/autoresponse/kickWorker'

describe('ireKickWaitMs', () => {
  it('delay=0 → no wait (immediate worker unchanged)', () => {
    expect(ireKickWaitMs(0)).toBe(0)
    expect(ireKickWaitMs(-1)).toBe(0)
    expect(ireKickWaitMs(Number.NaN)).toBe(0)
  })

  it('delay=5 → waits approximately until notBefore, under the serverless cap', () => {
    expect(ireKickWaitMs(5)).toBe(5_250)
    expect(ireKickWaitMs(5)).toBeLessThanOrEqual(IRE_KICK_MAX_WAIT_MS)
  })

  it('does not sleep longer than the platform execution budget', () => {
    expect(ireKickWaitMs(3600)).toBe(IRE_KICK_MAX_WAIT_MS)
    expect(IRE_KICK_MAX_WAIT_MS).toBe(15_000)
  })
})

describe('runAutoResponseKick', () => {
  it('delay=0 → existing worker with no sleep', async () => {
    const sleep = vi.fn(async () => undefined)
    const run = vi.fn(async () => ({ claimed: 1, sent: 1, skipped: 0, failed: 0 }))
    await expect(runAutoResponseKick({ delaySeconds: 0, limit: 5 }, { sleep, run })).resolves.toEqual({
      claimed: 1,
      sent: 1,
      skipped: 0,
      failed: 0,
    })
    expect(sleep).not.toHaveBeenCalled()
    expect(run).toHaveBeenCalledWith({ limit: 5 })
  })

  it('delay=5 → waits until due, then claims via the existing worker', async () => {
    const sleep = vi.fn(async () => undefined)
    const run = vi.fn(async () => ({ claimed: 1, sent: 1, skipped: 0, failed: 0 }))
    await runAutoResponseKick({ delaySeconds: 5, limit: 5 }, { sleep, run })
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(5_250)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith({ limit: 5 })
  })
})
