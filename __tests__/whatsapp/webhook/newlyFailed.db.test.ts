/**
 * `[wa-webhook] receipts newly failed`: the line the "newly failed receipts" Axiom
 * monitor matches. It must fire ONCE when a receipt becomes terminal `failed`, and
 * never again for that receipt, while `[wa-webhook] receipts failed` (the cron's
 * standing count) keeps logging on every run. Otherwise one historical failure would
 * re-alert every minute until someone requeued it.
 *
 * Real database and the real cron route. Applying an event is stubbed to fail, so no
 * message, lead or Meta call is involved. Synthetic data only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ fail: true }))
vi.mock('@/lib/inbox/autoresponse/kickWorker', () => ({ runAutoResponseKick: vi.fn(async () => ({})) }))
vi.mock('@/lib/whatsapp/webhook/processEvent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/webhook/processEvent')>()
  return {
    ...actual,
    processWhatsappEvent: vi.fn(async () => {
      if (h.fail) throw new actual.RetryableEventError('synthetic_test_failure')
      return { outcome: 'ignored', detail: 'test', kick: false, delaySeconds: 0 }
    }),
  }
})

import { db } from '@/config/db'
import { claimWhatsappEvents, recordWhatsappEvents } from '@/db/whatsappWebhookEvents'
import { runWhatsappWebhookWorker } from '@/lib/whatsapp/webhook/worker'

const PN = '__newly_failed_pn__'
const NEWLY = '[wa-webhook] receipts newly failed'
const STANDING = '[wa-webhook] receipts failed'
let agencyId = 0
let n = 0
let errors: string[] = []

const { GET: CRON } = await import('@/app/api/cron/whatsapp-webhook-events/route')
const cron = () => CRON(new Request('https://example.test/api/cron/whatsapp-webhook-events', { headers: { authorization: 'Bearer cron-secret-for-test' } }) as never)
const drain = () => runWhatsappWebhookWorker({ workerId: `nf-${++n}`, kick: async () => ({}) as never })
const receipts = () => db('whatsapp_webhook_events').where({ phoneNumberId: PN }).orderBy('id')
const makeDue = () => db('whatsapp_webhook_events').where({ phoneNumberId: PN, status: 'received' }).update({ nextAttemptAt: db.fn.now() })
const lines = (prefix: string) => errors.filter((l) => l.startsWith(prefix + ' ') || l === prefix)

async function record(count: number, maxAttempts: number) {
  const events = Array.from({ length: count }, (_, i) => ({
    agencyId,
    phoneNumberId: PN,
    eventKey: `nf:${n}:${i}:${Date.now()}`,
    kind: 'status' as const,
    orderingKey: null,
    payload: { synthetic: true },
  }))
  const { insertedIds } = await recordWhatsappEvents(events)
  await db('whatsapp_webhook_events').whereIn('id', insertedIds).update({ maxAttempts })
  return insertedIds
}

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__newly_failed__', autoResponseEnabled: false }).returning('id')
  agencyId = Number(a.id)
})

beforeEach(async () => {
  h.fail = true
  errors = []
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void errors.push(args.map(String).join(' ')))
  vi.stubEnv('CRON_SECRET', 'cron-secret-for-test')
  vi.stubEnv('AUTOMATION_API_KEY', undefined)
  await db('whatsapp_webhook_events').where({ phoneNumberId: PN }).del()
})

afterAll(async () => {
  vi.unstubAllEnvs()
  await db('whatsapp_webhook_events').where({ phoneNumberId: PN }).del()
  await db('agencies').where({ id: agencyId }).del()
  await db.destroy()
})

describe('receipts newly failed', () => {
  it('an old failed receipt does not raise a new-failure line on every later run, while the standing count keeps logging', async () => {
    await record(1, 2)
    expect(await drain()).toMatchObject({ retried: 1, newlyFailed: 0 })
    expect(lines(NEWLY)).toEqual([])

    await makeDue()
    expect(await drain()).toMatchObject({ retried: 1, newlyFailed: 1 })
    expect((await receipts()).map((r) => r.status)).toEqual(['failed'])
    expect(lines(NEWLY)).toHaveLength(1)

    // Three later cron runs: the receipt is still failed, nothing new failed.
    errors = []
    for (let i = 0; i < 3; i++) {
      const res = await cron()
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ newlyFailed: 0 })
    }
    expect(lines(NEWLY)).toEqual([])
    expect(lines(STANDING)).toHaveLength(3)
  })

  it('a retry that is not yet terminal never raises it', async () => {
    await record(1, 3)
    for (let i = 0; i < 2; i++) {
      await makeDue()
      expect(await drain()).toMatchObject({ retried: 1, newlyFailed: 0 })
    }
    expect((await receipts()).map((r) => r.status)).toEqual(['received'])
    expect(lines(NEWLY)).toEqual([])
  })

  it('several receipts failing in one run raise ONE line with their count, and counts only', async () => {
    await record(2, 1)
    expect(await drain()).toMatchObject({ newlyFailed: 2 })
    const [line] = lines(NEWLY)
    expect(lines(NEWLY)).toHaveLength(1)
    const fields = JSON.parse(line.slice(NEWLY.length + 1))
    expect(Object.keys(fields).sort()).toEqual(['fromAttempts', 'fromLease', 'newlyFailed', 'workerId'])
    expect(fields).toMatchObject({ newlyFailed: 2, fromAttempts: 2, fromLease: 0 })
    expect(line).not.toContain(PN)
  })

  it('a reclaimed final attempt is a new failure once, then never again', async () => {
    const [id] = await record(1, 1)
    const [leased] = await claimWhatsappEvents('worker-that-died', 10, { ids: [id] })
    expect(leased.id).toBe(id)
    await db('whatsapp_webhook_events').where({ id }).update({ lockedAt: new Date(Date.now() - 10 * 60_000) })

    expect(await drain()).toMatchObject({ reclaimed: 1, newlyFailed: 1 })
    expect(JSON.parse(lines(NEWLY)[0].slice(NEWLY.length + 1))).toMatchObject({ fromLease: 1, fromAttempts: 0 })
    expect((await receipts()).map((r) => r.status)).toEqual(['failed'])

    errors = []
    expect(await drain()).toMatchObject({ reclaimed: 0, newlyFailed: 0 })
    expect(lines(NEWLY)).toEqual([])
  })
})
