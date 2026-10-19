import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/** /api/cron/wa-assistant: CRON_SECRET only; runs the worker; never leaks an error. */
const worker = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('@/lib/waAssistant/worker', () => ({ runWaAssistantWorker: (...a: unknown[]) => worker.run(...a) }))

const SECRET = 'cron-secret-not-real-0123456789'
const req = (auth: string | null) => new NextRequest('https://getsocialcrm.com/api/cron/wa-assistant', { headers: auth ? { authorization: auth } : {} })

beforeEach(() => {
  process.env.CRON_SECRET = SECRET
  worker.run.mockReset()
  worker.run.mockResolvedValue({ disabled: false, reaped: 0, purged: 0, claimed: 0, outcomes: {} })
})
afterEach(() => {
  delete process.env.CRON_SECRET
})

describe('wa-assistant cron', () => {
  it('403 without the bearer secret; 500 when CRON_SECRET is unset; the worker never runs', async () => {
    const { GET } = await import('@/app/api/cron/wa-assistant/route')
    for (const a of [null, 'Bearer nope', SECRET]) expect((await GET(req(a))).status).toBe(403)
    delete process.env.CRON_SECRET
    expect((await GET(req(`Bearer ${SECRET}`))).status).toBe(500)
    expect(worker.run).not.toHaveBeenCalled()
  })

  it('runs the worker once and returns its summary', async () => {
    const { GET } = await import('@/app/api/cron/wa-assistant/route')
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(200)
    expect(worker.run).toHaveBeenCalledTimes(1)
    expect(await res.json()).toMatchObject({ ok: true, claimed: 0 })
  })

  it('a worker failure is a 500 with no detail', async () => {
    worker.run.mockRejectedValueOnce(new Error('db down: secret-ish detail'))
    const { GET } = await import('@/app/api/cron/wa-assistant/route')
    const res = await GET(req(`Bearer ${SECRET}`))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('secret-ish')
  })
})
