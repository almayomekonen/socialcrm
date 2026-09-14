/**
 * A · the scheduler route. Unit tests, no DB, no model.
 *
 * The route is an adapter and is tested as one: authenticate, then delegate.
 * Mirrors __tests__/inbox/autoresponse/cron.route.test.ts, which covers the
 * cron route this one is modelled on.
 *
 * Runs under `test:unit` (VITEST_NO_DB=1).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const runTick = vi.hoisted(() =>
  vi.fn(async () => ({
    skipped: false,
    agencies: 1,
    sweep: { agencies: 1, detected: 1, enqueued: 1, duplicates: 0, refused: 0, deferred: 0, errored: 0 },
    worker: {
      reclaimed: 0,
      batches: 1,
      claimed: 1,
      succeeded: 1,
      failed: 0,
      deadLettered: 0,
      decisions: 1,
      unrepresentable: 0,
      budgetExhausted: false,
    },
  })),
)

vi.mock('@/lib/ai/integration/signalTick', () => ({ runSignalTick: runTick }))
vi.mock('@/lib/automation/apiAuth', () => ({
  getAutomationSecret: () => 'test-cron',
  isAutomationAuthorized: (req: NextRequest, secret: string) =>
    req.headers.get('authorization') === `Bearer ${secret}` ||
    req.headers.get('x-cron-secret') === secret ||
    req.headers.get('x-automation-key') === secret,
}))

const { GET, POST, maxDuration } = await import('@/app/api/cron/signal-sweep/route')

function req(headers: Record<string, string> = {}) {
  return new NextRequest('https://getsocialcrm.com/api/cron/signal-sweep', { headers: new Headers(headers) })
}

beforeEach(() => {
  runTick.mockClear()
})

describe('A · /api/cron/signal-sweep authentication', () => {
  it('rejects an unauthenticated invocation without doing any work', async () => {
    const res = await GET(req())
    expect(res.status).toBe(403)
    expect(runTick).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret', async () => {
    const res = await GET(req({ authorization: 'Bearer not-the-secret' }))
    expect(res.status).toBe(403)
    expect(runTick).not.toHaveBeenCalled()
  })

  it.each([
    ['authorization', 'Bearer test-cron'],
    ['x-cron-secret', 'test-cron'],
    ['x-automation-key', 'test-cron'],
  ])('accepts the shared automation secret via %s', async (header, value) => {
    const res = await GET(req({ [header]: value }))
    expect(res.status).toBe(200)
    expect(runTick).toHaveBeenCalledTimes(1)
  })

  it('POST behaves identically to GET', async () => {
    const res = await POST(req({ authorization: 'Bearer test-cron' }))
    expect(res.status).toBe(200)
    expect(runTick).toHaveBeenCalledTimes(1)
  })

  it('returns the tick summary verbatim', async () => {
    const res = await GET(req({ authorization: 'Bearer test-cron' }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.skipped).toBe(false)
    expect(body.sweep.enqueued).toBe(1)
    expect(body.worker.decisions).toBe(1)
  })
})

describe('the route carries no identity and no logic', () => {
  const src = readFileSync(join(process.cwd(), 'app/api/cron/signal-sweep/route.ts'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

  it('declares the repository-standard maxDuration', () => {
    expect(maxDuration).toBe(60)
    expect(code).toContain('export const maxDuration = 60')
  })

  it('uses the existing shared-secret helper, not a bespoke check', () => {
    expect(code).toContain("from '@/lib/automation/apiAuth'")
    expect(code).toContain('isAutomationAuthorized(req, secret)')
    expect(code).toContain('getAutomationSecret()')
  })

  it('reads no user, no session and no agency from the request', () => {
    for (const forbidden of ['getUser', 'requireUser', 'getServerSession', 'searchParams', 'req.json(', 'agencyId']) {
      expect(code, `route reads ${forbidden}`).not.toContain(forbidden)
    }
  })

  it('delegates everything to the reusable tick — no detection, no queue logic here', () => {
    expect(code).toContain('await runSignalTick()')
    for (const forbidden of ['DETECTOR_LIST', 'enqueueSignal', 'claimSignalJobs', 'RuntimeScheduler']) {
      expect(code, `route contains ${forbidden}`).not.toContain(forbidden)
    }
  })
})

describe('the cron entry', () => {
  const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
    crons: { path: string; schedule: string }[]
  }

  it('registers /api/cron/signal-sweep at a one-minute cadence', () => {
    const entry = vercel.crons.find((c) => c.path === '/api/cron/signal-sweep')
    expect(entry, 'signal-sweep cron is not registered in vercel.json').toBeTruthy()
    expect(entry?.schedule).toBe('*/1 * * * *')
  })

  it('is registered exactly once', () => {
    expect(vercel.crons.filter((c) => c.path === '/api/cron/signal-sweep')).toHaveLength(1)
  })

  it('leaves every pre-existing cron untouched', () => {
    const others = vercel.crons.filter((c) => c.path !== '/api/cron/signal-sweep')
    expect(others).toEqual([
      { path: '/api/cron/analyze-conversations', schedule: '0 6 * * *' },
      { path: '/api/cron/email-automations', schedule: '0 * * * *' },
      { path: '/api/cron/whatsapp-template-sync', schedule: '0 */6 * * *' },
      { path: '/api/cron/automations-dispatch', schedule: '*/5 * * * *' },
      { path: '/api/cron/notifications-dispatch', schedule: '*/1 * * * *' },
      { path: '/api/cron/send-auto-responses', schedule: '*/1 * * * *' },
      // Wave 0 (Meta P0-4 / P0-5): the lead-ingestion recovery drain and the
      // scheduled connection-health sweep. Both are Facebook/WhatsApp
      // integration crons; neither touches the signal pipeline, which is the
      // property this assertion exists to protect.
      { path: '/api/cron/retry-webhook-failures', schedule: '*/15 * * * *' },
      { path: '/api/cron/connection-health', schedule: '0 * * * *' },
      // Wave 2A.2f: the WhatsApp Coexistence history importer's drain. Like the
      // Wave 0 entries above it is an integration cron and touches no part of
      // the signal pipeline — and it is doubly inert today, because history is
      // gated off and its allowlist is empty by default.
      { path: '/api/cron/history-import', schedule: '*/5 * * * *' },
      // Meta App Review: the Messenger webhook-receipt drain (retries, stale
      // leases, retention). An integration cron with no part in the signal
      // pipeline, and inert unless FACEBOOK_MESSENGER_ENABLED records receipts.
      { path: '/api/cron/messenger-events', schedule: '*/1 * * * *' },
    ])
  })
})
