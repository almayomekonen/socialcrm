import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Founder entitlement and personal reminders: the 50-live and 30-per-day limits
 * are waived (and audited as `founder_limit_waived`) for the verified founder
 * only. Consent, opt-out, approval, isolation, scheduling validation and every
 * delivery gate are unchanged. Real database and Action Runtime; Graph mocked;
 * nothing is sent.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { enterDispatch } from '@/db/ownerPersonalReminders/dispatchGate'
import { REMINDER_COPY } from '@/lib/waAssistant/reminders/copy'
import { enableDelivery, inboundFrom, insertReminder, resetControls } from '../reminders/deliveryFixtures'
import { MIN, agencies, ask, card, harness, owner, press, reminders, reset, say, run, setEnv, teardown, type Owner } from './reminderHarness'

let A: number
let B: number
let seq = 0
const grant = (o: Owner) => db('platform_entitlements').insert({ agencyId: o.agencyId, userId: o.u, entitlement: 'founder_unlimited_usage', reason: 'test founder', grantedBy: 'test' })
const asFixture = (o: Owner) => ({ agencyId: o.agencyId, userId: o.u, recipientId: o.r })

/** `n` live reminders inserted directly, due `startMs` from now, one minute apart. */
async function live(o: Owner, n: number, startMs = 25 * MIN) {
  const rows = Array.from({ length: n }, (_, i) => {
    const at = new Date(Date.now() + startMs + i * 1000)
    return {
      agencyId: o.agencyId, userId: o.u, recipientId: o.r, text: 'x', textLength: 1, remindAt: at, nextAttemptAt: at,
      anchorMessageTs: Math.floor(Date.now() / 1000), sourceWamid: `wamid.__fr_live_${++seq}`, status: 'scheduled',
      createdByActionId: `rem_${700000 + seq}_v1_create`,
    }
  })
  await db('owner_personal_reminders').insert(rows)
}
const waivers = (o: Owner) => db('owner_personal_reminder_events').where({ agencyId: o.agencyId, userId: o.u, type: 'founder_limit_waived' }).pluck('reason')

beforeAll(async () => {
  ;[A, B] = await agencies('__fr_a__', '__fr_b__')
})
beforeEach(async () => {
  await db.raw('TRUNCATE platform_entitlements') // row triggers do not fire on TRUNCATE (test cleanup only)
  await reset([A, B])
  setEnv([A, B])
  await resetControls()
})
afterAll(async () => {
  await db.raw('TRUNCATE platform_entitlements') // row triggers do not fire on TRUNCATE (test cleanup only)
  await resetControls()
  await teardown()
})

describe('reminder limits: waived for the founder only, and audited', () => {
  it('50 live reminders: the founder gets a card, approves, and the waiver is recorded at draft and approval', async () => {
    const f = await owner(A)
    await grant(f)
    await live(f, 50)
    const h = harness()
    const c = await card(f, h, 'בעוד 10 דקות תזכיר לי להתקשר לאבי')
    expect((await press(f, h, c.approve)).body).toContain('*התזכורת נקבעה*')
    expect(await waivers(f)).toEqual(['scheduled_limit', 'scheduled_limit'])
  })

  it('50 live reminders: another owner gets the limit message and no card', async () => {
    const o = await owner(A)
    await live(o, 50)
    const sent = await ask(o, harness(), 'בעוד 10 דקות תזכיר לי להתקשר לאבי')
    expect(sent.body).toBe(REMINDER_COPY.scheduledLimit)
    expect(sent.buttons).toBeUndefined()
  })

  it('30 for the recipient today: waived for the founder, enforced for another owner', async () => {
    const f = await owner(A)
    const o = await owner(A)
    await grant(f)
    await live(f, 30, 15 * MIN)
    await live(o, 30, 15 * MIN)
    expect((await card(f, harness(), 'בעוד 10 דקות תזכיר לי להתקשר לאבי')).body).toContain('*לקבוע תזכורת?*')
    expect(await waivers(f)).toEqual(['daily_limit'])
    expect((await ask(o, harness(), 'בעוד 10 דקות תזכיר לי להתקשר לאבי')).body).toContain('הגעת למקסימום של 30 תזכורות')
  })

  it('rescheduling with 50 live: waived for the founder; listing and cancelling work as for anyone', async () => {
    const f = await owner(A)
    await grant(f)
    const h = harness()
    await press(f, h, (await card(f, h, 'בעוד 10 דקות תזכיר לי להתקשר לאבי')).approve)
    await live(f, 50, 60 * MIN)
    expect((await press(f, h, (await card(f, h, 'תזיז את התזכורת להתקשר לאבי בעוד 30 דקות')).approve)).body).toContain('*התזכורת הוזזה*')
    expect(await waivers(f)).toContain('scheduled_limit')
    expect((await ask(f, h, 'מה התזכורות שלי')).body).toContain('להתקשר לאבי')
    expect((await press(f, h, (await card(f, h, 'תבטל את התזכורת להתקשר לאבי')).approve)).body).toContain('*התזכורת בוטלה*')
  })
})

describe('every protection still holds for the founder', () => {
  it('without consent v5: the Settings link, no card', async () => {
    const f = await owner(A, 'v4')
    await grant(f)
    expect((await ask(f, harness(), 'בעוד 10 דקות תזכיר לי להתקשר לאבי')).body).toBe(REMINDER_COPY.consent)
    expect(await reminders(f)).toHaveLength(0)
  })

  it('opted out: refused before anything is read, nothing drafted', async () => {
    const f = await owner(A)
    await grant(f)
    await db('owner_whatsapp_recipients').where({ id: f.r }).update({ status: 'opted_out', optedOutAt: new Date(), optOutSource: 'keyword' })
    const h = harness()
    await say(f, 'בעוד 10 דקות תזכיר לי להתקשר לאבי')
    await run(h)
    expect(await reminders(f)).toHaveLength(0)
    expect(h.runAgent).not.toHaveBeenCalled()
  })

  it('approval is still required: a rejected card schedules nothing', async () => {
    const f = await owner(A)
    await grant(f)
    const h = harness()
    await press(f, h, (await card(f, h, 'בעוד 10 דקות תזכיר לי להתקשר לאבי')).reject)
    expect(await reminders(f)).toEqual([expect.objectContaining({ status: 'discarded', discardReason: 'rejected' })])
  })

  it('isolation: the founder never sees another agency’s reminders', async () => {
    const f = await owner(A)
    const other = await owner(B)
    await grant(f)
    await live(other, 3)
    expect((await ask(f, harness(), 'מה התזכורות שלי')).body).toBe(REMINDER_COPY.none)
  })

  it('scheduling validation still applies: beyond 23 hours, one question, no card', async () => {
    const f = await owner(A)
    await grant(f)
    const sent = await ask(f, harness(), 'מחרתיים ב-10:00 תזכיר לי להתקשר לאבי')
    expect(sent.body).toContain('עד 23 שעות קדימה')
    expect(sent.buttons).toBeUndefined()
  })
})

describe('delivery gates are unchanged for the founder', () => {
  it('capacity: the recipient cap still fails the second dispatch; the kill switch still defers', async () => {
    const f = await owner(A)
    await grant(f)
    await enableDelivery({ recipientDailyCap: 1 })
    await inboundFrom(asFixture(f), Date.now() - MIN)
    const one = await insertReminder(asFixture(f), 'claimed')
    const two = await insertReminder(asFixture(f), 'claimed')
    expect((await enterDispatch({ reminderId: one.id, claimToken: one.claimToken, nowMs: Date.now(), exposure: 0 })).result).toBe('dispatching')
    expect(await enterDispatch({ reminderId: two.id, claimToken: two.claimToken, nowMs: Date.now(), exposure: 0 })).toEqual({ result: 'failed', reason: 'cap_recipient' })
    await enableDelivery({ trippedAt: new Date(), trippedReason: 'test' })
    const three = await insertReminder(asFixture(f), 'claimed')
    expect(await enterDispatch({ reminderId: three.id, claimToken: three.claimToken, nowMs: Date.now(), exposure: 0 })).toEqual({ result: 'deferred', reason: 'kill_switch' })
  })

  it('with sending off (the production state), nothing is ever dispatched for the founder', async () => {
    const f = await owner(A)
    await grant(f)
    const h = harness()
    await press(f, h, (await card(f, h, 'בעוד 10 דקות תזכיר לי להתקשר לאבי')).approve)
    const { tickPersonalReminders } = await import('@/lib/reminders/delivery/tick')
    const send = vi.fn()
    const [r] = await reminders(f)
    expect((await tickPersonalReminders({ send: send as never, nowMs: () => new Date(r.remindAt).getTime() + 1000 })).mode).toBe('dry_run')
    expect(send).not.toHaveBeenCalled()
  })
})
