import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression: production 2026-11-07, agency 103 (jobs 73–78). After rescheduling a
 * reminder to 20:30, "בעצם תבטל אותה", "ביטלת?", "אבל כתבת לי שיש תזכורת ב20:30"
 * and "אתה יכול לקבוע תזכורות בכלל?" all went to the generic Agent, which claimed
 * a cancellation that never happened, then that no reminder existed, then that it
 * cannot set reminders. Every one of them must be answered by the reminder flow,
 * from the data. Real database, real worker and webhook; model and Meta mocked.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { REMINDER_COPY } from '@/lib/waAssistant/reminders/copy'
import { waAgentRules } from '@/lib/waAssistant/agentRules'
import { agencies, ask, card, harness, owner, press, reminders, reset, run, say, setEnv, teardown, type Harness, type Owner } from './reminderHarness'

let A: number

const wall = (d: Date | string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(d))

/** The production sequence up to job 74: create → approve → reschedule → approve. */
async function rescheduled(o: Owner, h: Harness) {
  const c = await card(o, h, 'תזכיר להתקשר ללייה בעוד 3 דקות')
  await press(o, h, c.approve)
  const move = await card(o, h, 'תשנה את התזכורת בעוד 40 דקות')
  expect((await press(o, h, move.approve)).body).toContain('*התזכורת הוזזה*')
  const [r] = await reminders(o)
  expect(r).toMatchObject({ status: 'scheduled', version: 2 })
  return r
}

beforeAll(async () => {
  ;[A] = await agencies('__rm_followup_a__')
})
beforeEach(async () => {
  await reset([A])
  setEnv([A])
})
afterAll(async () => {
  await teardown()
})

describe('follow-ups to the reminder just handled stay in the reminder flow', () => {
  it('"בעצם תבטל אותה" → a cancel card for THAT reminder; nothing is claimed cancelled before approval', async () => {
    const o = await owner(A)
    const h = harness()
    const r = await rescheduled(o, h)
    const c = await card(o, h, 'בעצם תבטל אותה')
    expect(c.body).toContain('*לבטל את התזכורת?*')
    expect(c.body).toContain('להתקשר ללייה')
    expect((await db('owner_personal_reminders').where({ id: r.id }).first('status')).status).toBe('scheduled')
    await press(o, h, c.approve)
    expect((await db('owner_personal_reminders').where({ id: r.id }).first('status')).status).toBe('cancelled')
    expect(h.runAgent).not.toHaveBeenCalled()
  })

  it('"ביטלת?" before cancelling → the truth from the data: still scheduled', async () => {
    const o = await owner(A)
    const h = harness()
    const r = await rescheduled(o, h)
    const body = (await ask(o, h, 'ביטלת?')).body
    expect(body).toContain('*התזכורות הקרובות שלך*')
    expect(body).toContain(`ב-${wall(r.remindAt)} · להתקשר ללייה`)
    expect(h.runAgent).not.toHaveBeenCalled()
  })

  it('"אבל כתבת לי שיש תזכורת ב20:30" → lists the actual reminder, at any point in the conversation', async () => {
    const o = await owner(A)
    const h = harness()
    const r = await rescheduled(o, h)
    await ask(o, h, 'תודה') // an unrelated turn in between: the reminder word alone still routes it
    expect(h.runAgent).toHaveBeenCalledTimes(1)
    const body = (await ask(o, h, 'אבל כתבת לי שיש תזכורת ב20:30')).body
    expect(body).toContain(`ב-${wall(r.remindAt)} · להתקשר ללייה`)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
  })

  it('"אתה יכול לקבוע תזכורות בכלל?" → the real capability, never "only tasks/meetings"', async () => {
    const o = await owner(A)
    const h = harness()
    const body = (await ask(o, h, 'אתה יכול לקבוע תזכורות בכלל?')).body
    expect(body).toBe(REMINDER_COPY.capability)
    expect(h.runAgent).not.toHaveBeenCalled()
  })

  it('without a reminder step just before, "תבטל אותה" is not ours (the Agent handles it, as before)', async () => {
    const o = await owner(A)
    const h = harness()
    await say(o, 'תבטל אותה')
    await run(h)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
  })

  it('without consent v5, the capability answer adds the Settings link and nothing is listed', async () => {
    const o = await owner(A, 'v4')
    const h = harness()
    expect((await ask(o, h, 'אתה יכול לקבוע תזכורות בכלל?')).body).toContain(REMINDER_COPY.consent)
    expect((await ask(o, h, 'אבל כתבת לי שיש תזכורת ב20:30')).body).toBe(REMINDER_COPY.consent)
  })
})

describe('the Agent never states reminder facts', () => {
  it('reminder rules are added only when the switch is on', () => {
    expect(waAgentRules({ statusOn: false, notesOn: false, remindersOn: true })).toContain('לעולם אל תכתוב שתזכורת נקבעה, בוטלה')
    expect(waAgentRules({ statusOn: false, notesOn: false })).not.toContain('תזכורות אישיות')
  })
})
