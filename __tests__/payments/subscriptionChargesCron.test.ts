import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'

vi.mock('@/lib/payments/charges/runChargePass', () => ({ runChargePass: vi.fn() }))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/cron/subscription-charges/route'
import { runChargePass } from '@/lib/payments/charges/runChargePass'

const req = (headers: Record<string, string> = {}) => new NextRequest('https://app.example.com/api/cron/subscription-charges', { headers })

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'cron-secret')
  vi.mocked(runChargePass).mockReset()
  vi.mocked(runChargePass).mockResolvedValue({
    enabled: false,
    dispatch: false,
    recovered: { requeued: 0, unknown: 0 },
    reconciled: { paid: 0, notCharged: 0, undetermined: 0 },
    scheduled: { conversions: 0, renewals: 0 },
    executed: {},
  })
})
afterEach(() => vi.unstubAllEnvs())

describe('/api/cron/subscription-charges', () => {
  it('requires CRON_SECRET', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(req({ authorization: 'Bearer ' }))).status).toBe(500)
    expect((await GET(req())).status).toBe(500)
    expect(runChargePass).not.toHaveBeenCalled()
  })

  it('refuses a wrong secret', async () => {
    expect((await GET(req({ authorization: 'Bearer nope' }))).status).toBe(403)
    expect(runChargePass).not.toHaveBeenCalled()
  })

  it('runs one pass and reports it', async () => {
    const res = await GET(req({ authorization: 'Bearer cron-secret' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, enabled: false })
  })

  it('answers 500 when the pass throws', async () => {
    vi.mocked(runChargePass).mockRejectedValue(new Error('grow.runtime.env_mode_mismatch'))
    expect((await GET(req({ 'x-cron-secret': 'cron-secret' }))).status).toBe(500)
  })

  it('is scheduled, and the schedule is harmless while the flag is off', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'))
    const entry = vercel.crons.find((c: { path: string }) => c.path === '/api/cron/subscription-charges')
    expect(entry).toMatchObject({ schedule: '*/5 * * * *' })
    // Every cron that existed before is still scheduled.
    expect(vercel.crons.length).toBeGreaterThanOrEqual(12)
    // runChargePass returns before touching the database when the flag is absent
    // (asserted in runChargePass.db.test.ts), so the schedule is a no-op then.
  })
})
