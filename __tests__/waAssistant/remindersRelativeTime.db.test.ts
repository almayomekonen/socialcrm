import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "תזכיר לי בעוד 10 דקות להתקשר לדני", end to end, with a FIXED clock: the real
 * webhook entry point, the real worker, the real draft, card, approval and
 * Action Runtime, the stored row, and the real delivery tick. The model and
 * Meta's Graph API are mocked: no WhatsApp message is sent, and every owner,
 * number and agency is synthetic.
 *
 * The clock: only `Date` is faked, so the message's Meta timestamp, the worker's
 * "now" and the card are all derived from the same captured instant. The dates
 * are in 2030 for the reason given at TUESDAY_1420.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { tickPersonalReminders } from '@/lib/reminders/delivery/tick'
import { enableDelivery, resetControls } from '../reminders/deliveryFixtures'
import { MIN, agencies, ask, card, harness, owner, press, reminders, reset, setEnv, teardown } from './reminderHarness'

let A: number
// Fixed instants in 2030: the table requires "remindAt" > "createdAt", and "createdAt"
// comes from the database's own clock, so a faked date must stay in the future.
const TUESDAY_1420 = Date.parse('2030-11-12T12:20:00Z') // Tue 12.11.2030, 14:20 Jerusalem (UTC+2)
const LATE_2350 = Date.parse('2030-11-12T21:50:00Z') // 23:50 Jerusalem
const FALL_BACK_0140 = Date.parse('2030-10-26T22:40:00Z') // Sun 27.10.2030, 01:40 IDT: clocks go back at 02:00

const clockAt = (ms: number) => vi.useFakeTimers({ toFake: ['Date'], now: ms })
const stored = async (o: Awaited<ReturnType<typeof owner>>) => {
  const [row] = await reminders(o)
  return { ...row, remindAtMs: new Date(row.remindAt).getTime() }
}

beforeAll(async () => {
  ;[A] = await agencies('__rm_reltime_a__')
})
beforeEach(async () => {
  await reset([A])
  flags.agent = true
  setEnv([A])
})
afterEach(() => {
  vi.useRealTimers()
})
afterAll(async () => {
  await resetControls()
  await teardown()
})

describe('the owner says a relative time; SocialCRM computes it from the captured request time', () => {
  it.each([
    ['תזכיר לי בעוד 10 דקות להתקשר לדני', 10, 'היום ב-14:30'],
    ['תזכיר לי בעוד 5 דקות להתקשר לדני', 5, 'היום ב-14:25'],
    ['תזכיר לי עוד 5 דקות להתקשר לדני', 5, 'היום ב-14:25'],
    ['תזכיר לי בעוד שעה להתקשר לדני', 60, 'היום ב-15:20'],
    ['תזכיר לי בעוד חצי שעה להתקשר לדני', 30, 'היום ב-14:50'],
    ['תזכיר לי בעוד שעתיים להתקשר לדני', 120, 'היום ב-16:20'],
    ['תזכיר לי בעוד חמש עשרה דקות להתקשר לדני', 15, 'היום ב-14:35'],
  ])('%s → card "%i minutes" = %s; approved → stored at exactly that instant', async (text, minutes, label) => {
    clockAt(TUESDAY_1420)
    const o = await owner(A)
    const h = harness()
    const c = await card(o, h, text)
    expect(c.body).toContain('*לקבוע תזכורת?*')
    expect(c.body).toContain('תזכורת: להתקשר לדני')
    expect(c.body).toContain(`מתי: ${label}`)
    expect(h.runAgent).not.toHaveBeenCalled() // no model is asked what time it is
    const draft = await stored(o)
    expect(draft).toMatchObject({ status: 'proposed', text: 'להתקשר לדני', remindAtMs: TUESDAY_1420 + minutes * MIN })

    const done = await press(o, h, c.approve)
    expect(done.body).toContain('*התזכורת נקבעה*')
    expect(done.body).toContain(`מתי: ${label}`)
    expect(await stored(o)).toMatchObject({ status: 'scheduled', remindAtMs: TUESDAY_1420 + minutes * MIN })
  })

  it('"מחר בבוקר" → tomorrow 09:00 Jerusalem (07:00 UTC), shown before approval', async () => {
    clockAt(TUESDAY_1420)
    const o = await owner(A)
    const h = harness()
    const c = await card(o, h, 'תזכיר לי מחר בבוקר לשלוח הצעה לדני')
    expect(c.body).toContain('מתי: מחר ב-09:00')
    expect(c.body).toContain('תזכורת: לשלוח הצעה לדני')
    await press(o, h, c.approve)
    expect(await stored(o)).toMatchObject({ status: 'scheduled', remindAtMs: Date.parse('2030-11-13T07:00:00Z') })
  })

  it('across midnight: at 23:50, "בעוד 20 דקות" is tomorrow 00:10', async () => {
    clockAt(LATE_2350)
    const o = await owner(A)
    const h = harness()
    const c = await card(o, h, 'תזכיר לי בעוד 20 דקות להתקשר לדני')
    expect(c.body).toContain('מתי: מחר ב-00:10')
    await press(o, h, c.approve)
    expect(await stored(o)).toMatchObject({ status: 'scheduled', remindAtMs: LATE_2350 + 20 * MIN })
  })

  it('the night clocks go back: "בעוד שעה" at 01:40 is one real hour later (01:40 on the second pass)', async () => {
    clockAt(FALL_BACK_0140)
    const o = await owner(A)
    const h = harness()
    const c = await card(o, h, 'תזכיר לי בעוד שעה להתקשר לדני')
    expect(c.body).toContain('מתי: היום ב-01:40')
    await press(o, h, c.approve)
    expect(await stored(o)).toMatchObject({ remindAtMs: FALL_BACK_0140 + 60 * MIN })
  })

  it('a question, then a spoken answer: "מתי להזכיר לך?" → "עוד רבע שעה" is a quarter hour after the ANSWER', async () => {
    // Real clock here: the follow-up window compares the database's own createdAt,
    // which a faked Date cannot move. The expected instant comes from the answer's stored Meta time.
    const o = await owner(A)
    const h = harness()
    const q = await ask(o, h, 'תזכיר לי להתקשר לדני')
    expect(q.body).toContain('מתי להזכיר לך?')
    expect(q.buttons).toBeUndefined()
    expect(await reminders(o)).toHaveLength(0)
    const c = await card(o, h, 'עוד רבע שעה')
    expect(c.body).toContain('תזכורת: להתקשר לדני')
    const answer = (await db('wa_assistant_jobs').where({ recipientId: o.r }).orderBy('id', 'desc').first('messageTimestamp')) as { messageTimestamp: string }
    expect((await stored(o)).remindAtMs).toBe(Number(answer.messageTimestamp) * 1000 + 15 * MIN)
  })

  it('a genuinely unclear time gets one question, and nothing is drafted', async () => {
    clockAt(TUESDAY_1420)
    const o = await owner(A)
    const sent = await ask(o, harness(), 'תזכיר לי בעוד כמה דקות להתקשר לדני')
    expect(sent.body).toBe('בעוד כמה זמן בדיוק? למשל: בעוד 20 דקות.')
    expect(sent.buttons).toBeUndefined()
    expect(await reminders(o)).toHaveLength(0)
  })
})

describe('delivered at the intended time, by the real delivery tick (send mocked)', () => {
  const ENV = { OWNER_PERSONAL_REMINDERS_SEND_ENABLED: '1' }
  afterEach(() => {
    for (const k of Object.keys(ENV)) delete process.env[k]
  })

  it('"בעוד 10 דקות" at 14:20: not sent at 14:29:59, sent once at 14:30 to the owner who asked', async () => {
    clockAt(TUESDAY_1420)
    const o = await owner(A)
    const h = harness()
    const c = await card(o, h, 'תזכיר לי בעוד 10 דקות להתקשר לדני')
    await press(o, h, c.approve)
    const due = TUESDAY_1420 + 10 * MIN

    Object.assign(process.env, ENV)
    await enableDelivery({}, due - 30_000)
    // Isolation: nothing else may be due during these ticks.
    await db('owner_personal_reminders').whereNot({ agencyId: A }).whereIn('status', ['scheduled', 'claimed']).update({ status: 'cancelled', cancelReason: 'owner', cancelledAt: new Date(), finalizedAt: new Date() })
    const send = vi.fn(async (_input: { toE164: string; body: string }) => ({ kind: 'sent' as const, wamid: `wamid.rel.${Date.now()}` }))

    const early = await tickPersonalReminders({ send: send as never, nowMs: () => due - 1_000 })
    expect(early).toMatchObject({ mode: 'live', claimed: 0 })
    expect(send).not.toHaveBeenCalled()
    expect((await stored(o)).status).toBe('scheduled')

    const onTime = await tickPersonalReminders({ send: send as never, nowMs: () => due + 1_000 })
    expect(onTime).toMatchObject({ mode: 'live', claimed: 1, sent: 1 })
    expect(send).toHaveBeenCalledTimes(1)
    const phone = ((await db('owner_whatsapp_recipients').where({ id: o.r }).first('phoneE164')) as { phoneE164: string }).phoneE164
    expect(send.mock.calls[0][0].toE164).toBe(phone)
    expect(send.mock.calls[0][0].body).toContain('להתקשר לדני')
    expect((await stored(o)).status).toBe('sent')
  })
})
