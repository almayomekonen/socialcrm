import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const runWorker = vi.hoisted(() =>
  vi.fn(async () => ({ claimed: 2, sent: 1, skipped: 1, failed: 0 })),
)

vi.mock('@/lib/inbox/autoresponse/worker', () => ({ runAutoResponseWorker: runWorker }))
vi.mock('@/lib/automation/apiAuth', () => ({
  getAutomationSecret: () => 'test-cron',
  isAutomationAuthorized: (req: NextRequest, secret: string) =>
    req.headers.get('authorization') === `Bearer ${secret}`,
}))

const { GET } = await import('@/app/api/cron/send-auto-responses/route')

function req(auth: string | null) {
  const headers = new Headers()
  if (auth) headers.set('authorization', auth)
  return new NextRequest('https://getsocialcrm.com/api/cron/send-auto-responses', { headers })
}

beforeEach(() => {
  runWorker.mockClear()
})

describe('GET /api/cron/send-auto-responses', () => {
  it('drains due jobs through runAutoResponseWorker', async () => {
    const res = await GET(req('Bearer test-cron'))
    expect(res.status).toBe(200)
    expect(runWorker).toHaveBeenCalledTimes(1)
    expect(runWorker).toHaveBeenCalledWith()
    await expect(res.json()).resolves.toEqual({
      ok: true,
      claimed: 2,
      sent: 1,
      skipped: 1,
      failed: 0,
    })
  })

  it('rejects unauthorized callers without claiming', async () => {
    const res = await GET(req(null))
    expect(res.status).toBe(403)
    expect(runWorker).not.toHaveBeenCalled()
  })
})
