import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The real-phone demo script, rehearsed locally (Reminder Engine Phase 6):
 *
 *   1. the owner sends "תזכיר לי להתקשר לאבי בעוד 5 דקות"
 *   2. it is understood            3. a confirmation card comes back
 *   4. approve → exactly one scheduled reminder
 *   5. list, reschedule, cancel    6. nothing goes to Avi
 *   7. nothing is dispatched, even at and after the reminder's time
 *
 * Every network path is a trap: the agency WhatsApp senders throw if called, and
 * a real `fetch` fails the test. The only "send" is the mocked platform reply,
 * and every one must be addressed to the owner's own number.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))
const agencySend = vi.hoisted(() => vi.fn(() => { throw new Error('agency WhatsApp sender must not be called') }))
vi.mock('@/lib/whatsapp/sendMessage', async (orig) => ({ ...(await orig<typeof import('@/lib/whatsapp/sendMessage')>()), sendWhatsappText: agencySend, sendWhatsappInteractive: agencySend }))
vi.mock('@/lib/whatsapp/sendTemplateMessage', async (orig) => ({ ...(await orig<typeof import('@/lib/whatsapp/sendTemplateMessage')>()), sendWhatsappTemplate: agencySend }))

import { db } from '@/config/db'
import { tickPersonalReminders } from '@/lib/reminders/delivery/tick'
import { MIN, agencies, ask, card, harness, owner, press, reminders, reset, setEnv, teardown } from './reminderHarness'

let A: number
const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
  throw new Error('no real network call is allowed in the demo rehearsal')
})

beforeAll(async () => {
  ;[A] = await agencies('__rm_demo_103__')
})
beforeEach(async () => {
  await reset([A])
  setEnv([A])
})
afterAll(async () => {
  fetchSpy.mockRestore()
  await teardown()
})

describe('real-phone demo script, rehearsed', () => {
  it('create → approve → list → reschedule → cancel; only the owner is messaged; nothing is dispatched', async () => {
    const o = await owner(A)
    const h = harness()

    // 1–3. Understood, and a card with the text and the time.
    const c = await card(o, h, 'תזכיר לי להתקשר לאבי בעוד 5 דקות')
    expect(c.body).toContain('*לקבוע תזכורת?*')
    expect(c.body).toContain('תזכורת: להתקשר לאבי')
    expect(await reminders(o)).toEqual([expect.objectContaining({ status: 'proposed' })])

    // 4. Exactly one scheduled reminder.
    expect((await press(o, h, c.approve)).body).toContain('*התזכורת נקבעה*')
    const live = await reminders(o)
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({ status: 'scheduled', text: 'להתקשר לאבי' })

    // 5. List.
    expect((await ask(o, h, 'מה התזכורות שלי?')).body).toMatch(/1\. (היום|מחר) ב-\d{2}:\d{2} · להתקשר לאבי/)

    // 5. Reschedule.
    const move = await card(o, h, 'תזיז את התזכורת להתקשר לאבי בעוד 30 דקות')
    expect((await press(o, h, move.approve)).body).toContain('*התזכורת הוזזה*')
    const moved = await db('owner_personal_reminders').where({ id: live[0].id }).first('version', 'remindAt', 'status')
    expect(moved).toMatchObject({ version: 2, status: 'scheduled' })

    // 7. At and after its time: nothing is dispatched (sending disabled by default).
    const send = vi.fn()
    for (const at of [0, 1, 61].map((m) => new Date(moved.remindAt).getTime() + m * MIN)) {
      expect((await tickPersonalReminders({ send: send as never, nowMs: () => at })).mode).toBe('dry_run')
    }
    expect(send).not.toHaveBeenCalled()
    expect((await db('owner_personal_reminders').where({ id: live[0].id }).first('status', 'dispatchedAt'))).toEqual({ status: 'scheduled', dispatchedAt: null })

    // 5. Cancel.
    const cancel = await card(o, h, 'תבטל את התזכורת להתקשר לאבי')
    expect((await press(o, h, cancel.approve)).body).toContain('*התזכורת בוטלה*')
    expect((await reminders(o)).map((r) => r.status)).toEqual(['cancelled'])

    // 6. Only the owner was ever messaged; Avi (or anyone else) never.
    const to = new Set(h.sendText.mock.calls.map((call) => (call[0] as { toE164: string }).toE164))
    expect([...to]).toEqual([`+${o.digits}`])
    expect(agencySend).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(h.runAgent).not.toHaveBeenCalled()
  })
})
