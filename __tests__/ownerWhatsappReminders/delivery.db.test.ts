import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { scheduleReminder } from '@/db/ownerWhatsappReminders/schedule'
import { tickOwnerWhatsappReminders } from '@/lib/ownerWhatsappReminders/tick'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { MIN, ago, agency, cleanup, conversation, deliveries, escalate, exactEscalatedAt, message, mockGraph, recipient, resetBetweenTests, setLiveEnv, user } from './reminderFixtures'

/**
 * Sending: the re-check under lock, opt-out ordering, concurrency, unknown
 * outcomes, retries, the account pause, quiet hours and the cooldown.
 */
let A: number
let seq = 0

beforeAll(async () => {
  A = await agency('__owr_delivery_a__')
})
beforeEach(async () => {
  await resetBetweenTests()
  await db('auto_response_settings').where({ agencyId: A }).del()
  setLiveEnv([A])
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  await cleanup()
})

/** A due hand-off with one active ADMIN recipient. */
async function dueHandoff(digits: string) {
  const admin = await user(A)
  const recipientId = await recipient(A, admin, digits)
  const c = await conversation(A, { lead: false })
  const escalatedAt = ago(121 * MIN)
  await escalate(c, escalatedAt)
  return { c, admin, recipientId, escalatedAt }
}

/** Schedule directly, for a later attempt, so something can happen in between. */
async function scheduleOnly(h: Awaited<ReturnType<typeof dueHandoff>>) {
  const now = new Date()
  const out = await scheduleReminder({
    candidate: { conversationId: h.c.id, agencyId: A, leadId: null, handlerUserId: null, customerWaId: h.c.customerWaId, escalatedAt: h.escalatedAt, escalatedAtExact: await exactEscalatedAt(h.c.id) },
    recipientIds: [h.recipientId], agencyIds: [A], notBefore: new Date(now.getTime() + 60 * MIN), now,
  })
  expect(out).toBe('scheduled')
  await db('owner_whatsapp_reminder_deliveries').update({ nextAttemptAt: ago(MIN) })
}
const stop = (digits: string, text = 'הסר') =>
  processPlatformMessage({ id: `wamid.__owr_stop_${++seq}`, from: digits, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } })

describe('re-checked under lock immediately before sending', () => {
  it('an opt-out after scheduling: cancelled, nothing sent', async () => {
    const h = await dueHandoff('972500000201')
    await scheduleOnly(h)
    expect(await stop('972500000201')).toBe('opted_out')
    const g = mockGraph()
    await tickOwnerWhatsappReminders()
    expect(g.calls).toEqual([])
    expect(await deliveries()).toMatchObject([{ status: 'cancelled', cancelReason: 'recipient_not_active' }])
    expect(await db('owner_whatsapp_reminders')).toMatchObject([{ status: 'cancelled' }])
  })

  it('a human reply after scheduling: cancelled, nothing sent', async () => {
    const h = await dueHandoff('972500000202')
    await scheduleOnly(h)
    await message(h.c, { dir: 'outbound', at: new Date(), userId: h.admin })
    const g = mockGraph()
    await tickOwnerWhatsappReminders()
    expect(g.calls).toEqual([])
    expect(await deliveries()).toMatchObject([{ status: 'cancelled', cancelReason: 'no_longer_eligible' }])
  })

  it('an opt-out arriving DURING a send waits for it: never a send after a committed opt-out', async () => {
    await dueHandoff('972500000203')
    let release!: () => void
    const g = mockGraph(() => new Promise<Response>((r) => (release = () => r(new Response(JSON.stringify({ messages: [{ id: 'wamid.INFLIGHT' }] }), { status: 200 })))))
    const tick = tickOwnerWhatsappReminders()
    await vi.waitFor(() => expect(g.calls).toHaveLength(1), { timeout: 5000 })
    let optedOut = false
    const optOut = stop('972500000203').then((r) => ((optedOut = true), r))
    await new Promise((r) => setTimeout(r, 300))
    expect(optedOut).toBe(false)
    release()
    await tick
    expect(await optOut).toBe('opted_out')
    const [d] = await deliveries()
    const r = await db('owner_whatsapp_recipients').first('status', 'optedOutAt')
    expect(d.status).toBe('sent')
    expect(r.status).toBe('opted_out')
    expect(new Date(r.optedOutAt).getTime()).toBeGreaterThanOrEqual(new Date(d.sentAt).getTime())
  })
})

describe('concurrency and unknown outcomes', () => {
  it('two ticks at once send exactly once', async () => {
    await dueHandoff('972500000211')
    const g = mockGraph()
    await Promise.all([tickOwnerWhatsappReminders(), tickOwnerWhatsappReminders(), tickOwnerWhatsappReminders()])
    expect(g.calls).toHaveLength(1)
    expect(await db('owner_whatsapp_reminders')).toHaveLength(1)
  })

  it('an unknown outcome is never retried, and still counts for the cooldown', async () => {
    const h = await dueHandoff('972500000212')
    const g = mockGraph(() => Promise.reject(new TypeError('fetch failed')))
    await tickOwnerWhatsappReminders()
    expect(await deliveries()).toMatchObject([{ status: 'unknown', errorCode: 'network' }])
    await escalate(h.c, ago(120 * MIN + 30_000))
    await tickOwnerWhatsappReminders()
    await tickOwnerWhatsappReminders()
    expect(g.calls).toHaveLength(1)
  })

  it('a delivery stuck in sending (crash mid-send) becomes unknown and is not resent', async () => {
    const h = await dueHandoff('972500000213')
    await scheduleOnly(h)
    await db('owner_whatsapp_reminder_deliveries').update({ status: 'sending', lockedAt: ago(5 * MIN), attempts: 1 })
    const g = mockGraph()
    expect((await tickOwnerWhatsappReminders()).reaped).toBe(1)
    expect(g.calls).toEqual([])
    expect(await deliveries()).toMatchObject([{ status: 'unknown', errorCode: 'lease_expired' }])
  })
})

describe('Meta rejections', () => {
  it('rate limits are retried with backoff, then fail after 3 retries', async () => {
    await dueHandoff('972500000221')
    const g = mockGraph(() => new Response(JSON.stringify({ error: { code: 130429 } }), { status: 400 }))
    let now = Date.now()
    for (let i = 0; i < 6; i++) {
      await tickOwnerWhatsappReminders({ now: new Date(now) })
      now += 16 * MIN
    }
    expect(g.calls).toHaveLength(4)
    expect(await deliveries()).toMatchObject([{ status: 'failed', errorScope: 'rate_limit', errorCode: '130429' }])
  })

  it('an account-wide rejection fails the delivery and pauses every send for an hour', async () => {
    await dueHandoff('972500000222')
    const g = mockGraph(() => new Response(JSON.stringify({ error: { code: 190 } }), { status: 401 }))
    await tickOwnerWhatsappReminders()
    expect(await deliveries()).toMatchObject([{ status: 'failed', errorScope: 'account' }])
    await dueHandoff('972500000223')
    expect((await tickOwnerWhatsappReminders()).paused).toBe(true)
    expect(g.calls).toHaveLength(1)
  })
})

describe('quiet hours and the cooldown', () => {
  it('inside the agency\'s quiet hours nothing is sent; the delivery waits for the window to end', async () => {
    const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Jerusalem' }).format(new Date()))
    await db('auto_response_settings').insert({ agencyId: A, channel: 'whatsapp', quietHours: { tz: 'Asia/Jerusalem', startHour: hour, endHour: (hour + 2) % 24 } })
    await dueHandoff('972500000231')
    const g = mockGraph()
    await tickOwnerWhatsappReminders()
    expect(g.calls).toEqual([])
    const [d] = await deliveries()
    expect(d.status).toBe('scheduled')
    expect(new Date(d.nextAttemptAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('a re-escalation within 12 hours of a sent reminder is not reminded again', async () => {
    const h = await dueHandoff('972500000232')
    const g = mockGraph()
    await tickOwnerWhatsappReminders()
    await escalate(h.c, ago(120 * MIN + 30_000))
    await tickOwnerWhatsappReminders()
    expect(g.calls).toHaveLength(1)
    expect(await db('owner_whatsapp_reminders')).toHaveLength(1)
  })

  it('a reminder that definitively failed for the recipient does not block a later escalation', async () => {
    const h = await dueHandoff('972500000233')
    let n = 0
    const g = mockGraph(() => (++n === 1 ? new Response(JSON.stringify({ error: { code: 131026 } }), { status: 400 }) : new Response(JSON.stringify({ messages: [{ id: 'wamid.LATER' }] }), { status: 200 })))
    await tickOwnerWhatsappReminders()
    await escalate(h.c, ago(120 * MIN + 30_000))
    await tickOwnerWhatsappReminders()
    expect(g.calls).toHaveLength(2)
    expect((await deliveries()).map((d) => d.status)).toEqual(['failed', 'sent'])
  })
})
