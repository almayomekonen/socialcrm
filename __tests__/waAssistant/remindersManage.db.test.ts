import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Reminder Engine Phase 6: listing, cancelling and rescheduling the owner's own
 * reminders from WhatsApp, and every attempt to reach someone else's. Real
 * database, real Action Runtime; the model and Meta are mocked.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { decideOnAction } from '@/lib/agent/actions/bridge'
import { REMINDER_COPY } from '@/lib/waAssistant/reminders/copy'
import { MIN, agencies, ask, card, harness, owner, press, reminders, reset, say, setEnv, tap, run, teardown, type Harness, type Owner } from './reminderHarness'

let A: number
let B: number

/** Create and approve one reminder through the real flow. */
async function scheduled(o: Owner, h: Harness, words: string) {
  const c = await card(o, h, words)
  expect((await press(o, h, c.approve)).body).toContain('*התזכורת נקבעה*')
  return (await reminders(o)).at(-1)!
}

beforeAll(async () => {
  ;[A, B] = await agencies('__rm_manage_a__', '__rm_manage_b__')
})
beforeEach(async () => {
  await reset([A, B])
  flags.agent = true
  setEnv([A, B])
})
afterAll(async () => {
  await teardown()
})

describe('listing', () => {
  it('nothing upcoming → says so, with an example', async () => {
    const o = await owner(A)
    expect((await ask(o, harness(), 'מה התזכורות שלי?')).body).toBe(REMINDER_COPY.none)
  })

  it('upcoming reminders, soonest first, only scheduled ones', async () => {
    const o = await owner(A)
    const h = harness()
    await scheduled(o, h, 'תזכיר לי בעוד 40 דקות לשלוח הצעה')
    await scheduled(o, h, 'תזכיר לי בעוד 20 דקות להתקשר לאבי')
    await card(o, h, 'תזכיר לי בעוד 30 דקות לבדוק משהו') // a draft: never listed
    const body = (await ask(o, h, 'אילו תזכורות יש לי')).body
    expect(body).toMatch(/1\. .* · להתקשר לאבי\n2\. .* · לשלוח הצעה/)
    expect(body).not.toContain('לבדוק משהו')
  })

  it('without consent v5 → the Settings link, not the list', async () => {
    const o = await owner(A, 'v4')
    expect((await ask(o, harness(), 'מה התזכורות שלי')).body).toBe(REMINDER_COPY.consent)
  })
})

describe('cancelling', () => {
  it('names it → card → approve → cancelled, nothing at its time', async () => {
    const o = await owner(A)
    const h = harness()
    const r = await scheduled(o, h, 'תזכיר לי בעוד 30 דקות להתקשר לאבי')
    const c = await card(o, h, 'תבטל את התזכורת להתקשר לאבי')
    expect(c.body).toContain('*לבטל את התזכורת?*')
    expect(c.titles).toEqual(['לבטל את התזכורת', 'להשאיר'])
    expect((await press(o, h, c.approve)).body).toContain('*התזכורת בוטלה*')
    expect(await db('owner_personal_reminders').where({ id: r.id }).first('status', 'cancelReason')).toEqual({ status: 'cancelled', cancelReason: 'owner' })
  })

  it('"להשאיר" keeps it, and a later cancel request still works (a new action per request)', async () => {
    const o = await owner(A)
    const h = harness()
    const r = await scheduled(o, h, 'תזכיר לי בעוד 30 דקות להתקשר לאבי')
    const first = await card(o, h, 'תבטל את התזכורת להתקשר לאבי')
    expect((await press(o, h, first.reject)).body).toBe(REMINDER_COPY.kept)
    expect((await db('owner_personal_reminders').where({ id: r.id }).first('status')).status).toBe('scheduled')
    const second = await card(o, h, 'תבטל את התזכורת להתקשר לאבי')
    await press(o, h, second.approve)
    expect((await db('owner_personal_reminders').where({ id: r.id }).first('status')).status).toBe('cancelled')
  })

  it('two matches → asks which, and the time in the answer picks one', async () => {
    const o = await owner(A)
    const h = harness()
    await scheduled(o, h, 'תזכיר לי בעוד 20 דקות להתקשר לאבי')
    const later = await scheduled(o, h, 'תזכיר לי בעוד 50 דקות להתקשר לרון')
    const q = await ask(o, h, 'תבטל את התזכורת להתקשר')
    expect(q.body).toContain(REMINDER_COPY.askWhichCancel)
    expect(q.buttons).toBeUndefined()
    const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(later.remindAt))
    const c = await card(o, h, hhmm)
    expect(c.body).toContain('להתקשר לרון')
  })

  it('no match → says so and lists what exists', async () => {
    const o = await owner(A)
    const h = harness()
    await scheduled(o, h, 'תזכיר לי בעוד 20 דקות להתקשר לאבי')
    const sent = await ask(o, h, 'תבטל את התזכורת לקנות חלב')
    expect(sent.body).toContain(REMINDER_COPY.noMatch)
    expect(sent.body).toContain('להתקשר לאבי')
  })
})

describe('rescheduling', () => {
  it('names it and a new time → card → approve → moved, version bumped', async () => {
    const o = await owner(A)
    const h = harness()
    const r = await scheduled(o, h, 'תזכיר לי בעוד 20 דקות להתקשר לאבי')
    const c = await card(o, h, 'תזיז את התזכורת להתקשר לאבי בעוד 45 דקות')
    expect(c.body).toContain('*להזיז את התזכורת?*')
    const req = (await db('wa_assistant_jobs').where({ recipientId: o.r }).orderBy('id', 'desc').first('messageTimestamp')) as { messageTimestamp: string }
    expect((await press(o, h, c.approve)).body).toContain('*התזכורת הוזזה*')
    const moved = await db('owner_personal_reminders').where({ id: r.id }).first('version', 'remindAt', 'status')
    expect(moved.version).toBe(2)
    expect(new Date(moved.remindAt).getTime()).toBe(Number(req.messageTimestamp) * 1000 + 45 * MIN)
  })

  it('no new time → "לאיזו שעה להזיז?", and the answer completes it', async () => {
    const o = await owner(A)
    const h = harness()
    await scheduled(o, h, 'תזכיר לי בעוד 20 דקות להתקשר לאבי')
    expect((await ask(o, h, 'תזיז את התזכורת להתקשר לאבי')).body).toBe(REMINDER_COPY.askNewTime)
    expect((await card(o, h, 'בעוד שעה')).body).toContain('לזמן חדש:')
  })

  it('an outdated card (the reminder moved since) changes nothing', async () => {
    const o = await owner(A)
    const h = harness()
    const r = await scheduled(o, h, 'תזכיר לי בעוד 20 דקות להתקשר לאבי')
    const old = await card(o, h, 'תזיז את התזכורת להתקשר לאבי בעוד 30 דקות')
    await db('owner_personal_reminders').where({ id: r.id }).update({ version: 2 })
    expect((await press(o, h, old.approve)).body).toBe(REMINDER_COPY.changed)
    expect((await db('owner_personal_reminders').where({ id: r.id }).first('remindAt')).remindAt).toEqual(r.remindAt)
  })
})

describe('another owner’s reminders are unreachable', () => {
  it('another agency: not listed, not cancellable by name', async () => {
    const a = await owner(A)
    const b = await owner(B)
    const h = harness()
    await scheduled(a, h, 'תזכיר לי בעוד 20 דקות להתקשר לאבי')
    expect((await ask(b, h, 'מה התזכורות שלי')).body).toBe(REMINDER_COPY.none)
    expect((await ask(b, h, 'תבטל את התזכורת להתקשר לאבי')).body).toBe(REMINDER_COPY.none)
    expect(await db('agent_actions').where({ agencyId: B })).toHaveLength(0)
  })

  it('another user in the SAME agency: not listed, not cancellable', async () => {
    const a = await owner(A)
    const colleague = await owner(A)
    const h = harness()
    await scheduled(a, h, 'תזכיר לי בעוד 20 דקות להתקשר לאבי')
    expect((await ask(colleague, h, 'מה התזכורות שלי')).body).toBe(REMINDER_COPY.none)
    expect((await ask(colleague, h, 'תבטל את התזכורת להתקשר לאבי')).body).toBe(REMINDER_COPY.none)
  })

  it('a card button replayed from another number does nothing', async () => {
    const a = await owner(A)
    const b = await owner(B)
    const h = harness()
    const c = await card(a, h, 'תזכיר לי בעוד 20 דקות להתקשר לאבי')
    await tap(b, c.approve)
    await run(h)
    expect(h.last().toE164).toBe(`+${b.digits}`)
    expect(h.last().body).not.toContain('נקבעה')
    expect((await reminders(a))[0].status).toBe('proposed')
  })

  it('deciding another agency’s action directly is refused by the runtime', async () => {
    const a = await owner(A)
    const b = await owner(B)
    const h = harness()
    await card(a, h, 'תזכיר לי בעוד 20 דקות להתקשר לאבי')
    const [action] = await db('agent_actions').where({ agencyId: A })
    const r = await decideOnAction({ actionId: action.actionId, argsHash: action.argsHash, decision: 'APPROVED', scope: { agencyId: B, userId: b.u, role: 'ADMIN' } as never })
    expect(r.ok).toBe(false)
    expect((await reminders(a))[0].status).toBe('proposed')
  })

  it('an opted-out owner is refused before anything is read', async () => {
    const o = await owner(A)
    const h = harness()
    await db('owner_whatsapp_recipients').where({ id: o.r }).update({ status: 'opted_out', optedOutAt: new Date(), optOutSource: 'keyword' })
    await say(o, 'בעוד 5 דקות תזכיר לי להתקשר לאבי')
    await run(h)
    expect(await reminders(o)).toHaveLength(0)
    expect(h.runAgent).not.toHaveBeenCalled()
  })
})

