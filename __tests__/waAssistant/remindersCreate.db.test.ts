import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Reminder Engine Phase 6: creating a personal reminder from the owner's
 * WhatsApp. Real database, real Action Runtime, real webhook; the model and
 * Meta are mocked. No WhatsApp message is sent, and delivery stays disabled.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { handleReminderMessage } from '@/lib/waAssistant/reminders/route'
import { REMINDER_COPY } from '@/lib/waAssistant/reminders/copy'
import { tickPersonalReminders } from '@/lib/reminders/delivery/tick'
import { CONNECT_LINK } from '@/lib/waAssistant/render'
import { MIN, agencies, ask, card, harness, lastJob, owner, press, reminders, reset, run, say, setEnv, teardown, type Owner } from './reminderHarness'

let A: number
let OFF: number
const scope = (o: Owner) => ({ agencyId: o.agencyId, userId: o.u, role: 'ADMIN' }) as never

beforeAll(async () => {
  ;[A, OFF] = await agencies('__rm_create_a__', '__rm_create_off__')
})
beforeEach(async () => {
  await reset([A, OFF])
  flags.agent = true
  setEnv([A], [OFF])
})
afterAll(async () => {
  await teardown()
})

describe('natural-language creation, only after approval', () => {
  it('"בעוד 5 דקות תזכיר לי להתקשר לאבי" → a card with the text and the time; nothing scheduled until approved', async () => {
    const o = await owner(A)
    const h = harness()
    const c = await card(o, h, 'בעוד 5 דקות תזכיר לי להתקשר לאבי')
    expect(c.body).toContain('תזכורת: להתקשר לאבי')
    expect(c.body).toMatch(/מתי: (היום|מחר) ב-\d{2}:\d{2}/)
    expect(c.titles).toEqual(['לאשר ולקבוע', 'ביטול'])
    expect(h.runAgent).not.toHaveBeenCalled()
    const [draft] = await reminders(o)
    expect(draft).toMatchObject({ status: 'proposed', text: 'להתקשר לאבי', recipientId: String(o.r) })
    const job = (await db('wa_assistant_jobs').where({ recipientId: o.r }).first('messageTimestamp')) as { messageTimestamp: string }
    expect(new Date(draft.remindAt).getTime()).toBe(Number(job.messageTimestamp) * 1000 + 5 * MIN)
    // The action holds the draft's id, version and time, never the text.
    const [action] = await db('agent_actions').where({ agencyId: A })
    expect(action).toMatchObject({ actionType: 'create_reminder', actionId: `rem_${draft.id}_v1_create` })
    expect(JSON.stringify(action.args)).not.toContain('אבי')

    const done = await press(o, h, c.approve)
    expect(done.body).toContain('*התזכורת נקבעה*')
    const [row] = await reminders(o)
    expect(row).toMatchObject({ status: 'scheduled', createdByActionId: `rem_${draft.id}_v1_create` })
    expect(await db('owner_personal_reminder_events').where({ reminderId: row.id }).pluck('type')).toEqual(['proposed', 'scheduled'])
  })

  it('rejected → the draft is discarded, its text cleared, nothing scheduled', async () => {
    const o = await owner(A)
    const h = harness()
    const c = await card(o, h, 'תזכיר לי בעוד שעה לבדוק את ההצעה')
    expect((await press(o, h, c.reject)).body).toBe(REMINDER_COPY.rejected)
    expect(await reminders(o)).toEqual([expect.objectContaining({ status: 'discarded', discardReason: 'rejected', text: null })])
    expect((await press(o, h, c.approve)).body).toBe(REMINDER_COPY.alreadyDecided)
    expect(await db('owner_personal_reminders').where({ agencyId: A, status: 'scheduled' })).toHaveLength(0)
  })

  it('a second tap on approve schedules nothing twice', async () => {
    const o = await owner(A)
    const h = harness()
    const c = await card(o, h, 'תזכיר לי בעוד 20 דקות לשלוח הצעה')
    await press(o, h, c.approve)
    expect((await press(o, h, c.approve)).body).toBe(REMINDER_COPY.alreadyDecided)
    expect(await reminders(o)).toHaveLength(1)
  })

  it('a new request supersedes the previous card', async () => {
    const o = await owner(A)
    const h = harness()
    const first = await card(o, h, 'תזכיר לי בעוד 20 דקות להתקשר לרון')
    await card(o, h, 'תזכיר לי בעוד 30 דקות להתקשר לדנה')
    expect((await press(o, h, first.approve)).body).toBe(REMINDER_COPY.superseded)
    expect((await reminders(o)).map((r) => r.status)).toEqual(['discarded', 'proposed'])
  })
})

describe('consent v5 is required', () => {
  it('a v4 owner gets the Settings link: no draft, no action, no card', async () => {
    const o = await owner(A, 'v4')
    const h = harness()
    const sent = await ask(o, h, 'בעוד 5 דקות תזכיר לי להתקשר לאבי')
    expect(sent.body).toBe(REMINDER_COPY.consent)
    expect(sent.body).toContain(CONNECT_LINK)
    expect(sent.buttons).toBeUndefined()
    expect(await reminders(o)).toHaveLength(0)
    expect(await db('agent_actions').where({ agencyId: A })).toHaveLength(0)
  })

  it('consent withdrawn while the card is open → the approval discards the draft', async () => {
    const o = await owner(A)
    const h = harness()
    const c = await card(o, h, 'תזכיר לי בעוד 20 דקות להתקשר לאבי')
    await db('owner_whatsapp_recipients').where({ id: o.r }).update({ consentTextVersion: 'v4' })
    expect((await press(o, h, c.approve)).body).toBe(REMINDER_COPY.consent)
    expect(await reminders(o)).toEqual([expect.objectContaining({ status: 'discarded', discardReason: 'consent' })])
  })
})

describe('ambiguous or missing details → one question, never a guess', () => {
  it.each([
    ['תזכיר לי בשלוש להתקשר לאבי', 'ב-3 בבוקר או בערב?'],
    ['תזכיר לי בעוד קצת להתקשר לאבי', 'בעוד כמה זמן בדיוק? למשל: בעוד 20 דקות.'],
    ['תזכיר לי בעוד 10 דקות מחר ב-9 להתקשר', 'כתבת גם "בעוד…" וגם שעה. מתי להזכיר לך?'],
    ['מחרתיים ב-10:00 תזכיר לי להתקשר לאבי', 'כרגע אפשר לקבוע תזכורת עד 23 שעות קדימה'],
  ])('%s', async (words, question) => {
    const o = await owner(A)
    const h = harness()
    const sent = await ask(o, h, words)
    expect(sent.body).toContain(question)
    expect(sent.buttons).toBeUndefined()
    expect(await reminders(o)).toHaveLength(0)
  })

  it('no time → "מתי?", then the answer completes the SAME request (text kept)', async () => {
    const o = await owner(A)
    const h = harness()
    expect((await ask(o, h, 'תזכיר לי להתקשר לאבי')).body).toContain('מתי להזכיר לך?')
    const c = await card(o, h, 'בעוד 20 דקות')
    expect(c.body).toContain('תזכורת: להתקשר לאבי')
    const answer = await lastJob(o)
    const [draft] = await reminders(o)
    expect(draft.sourceWamid).toBe(answer.wamid)
    expect(new Date(draft.remindAt).getTime()).toBe(answer.messageTimestamp * 1000 + 20 * MIN)
  })

  it('no text → "מה להזכיר לך?", the time stays anchored on the message that said it', async () => {
    const o = await owner(A)
    const h = harness()
    expect((await ask(o, h, 'תזכיר לי בעוד 10 דקות')).body).toBe(REMINDER_COPY.askText)
    const first = (await db('wa_assistant_jobs').where({ recipientId: o.r }).orderBy('id').first('messageTimestamp')) as { messageTimestamp: string }
    const c = await card(o, h, 'להתקשר לאבי')
    expect(c.body).toContain('תזכורת: להתקשר לאבי')
    const [draft] = await reminders(o)
    expect(new Date(draft.remindAt).getTime()).toBe(Number(first.messageTimestamp) * 1000 + 10 * MIN)
  })

  it('an unverified Meta timestamp schedules nothing', async () => {
    const o = await owner(A)
    await say(o, 'בעוד 5 דקות תזכיר לי להתקשר לאבי')
    await db('wa_assistant_jobs').where({ recipientId: o.r }).update({ timestampSource: 'server' })
    const h = harness()
    await run(h)
    expect(h.last().body).toBe(REMINDER_COPY.unverified)
    expect(await reminders(o)).toHaveLength(0)
  })
})

describe('duplicates', () => {
  it('a redelivered webhook (same wamid) makes no second job, draft or card', async () => {
    const o = await owner(A)
    const h = harness()
    expect(await say(o, 'בעוד 5 דקות תזכיר לי להתקשר לאבי', 'wamid.__rm_dup_1')).toBe('assistant_queued')
    expect(await say(o, 'בעוד 5 דקות תזכיר לי להתקשר לאבי', 'wamid.__rm_dup_1')).toBe('duplicate')
    await run(h)
    expect(h.sendText).toHaveBeenCalledTimes(1)
    expect(await reminders(o)).toHaveLength(1)
  })

  it('re-processing the same job reuses the draft, the action and the token', async () => {
    const o = await owner(A)
    const h = harness()
    await card(o, h, 'בעוד 5 דקות תזכיר לי להתקשר לאבי')
    const job = await lastJob(o)
    const again = await handleReminderMessage({ job, scope: scope(o), nowMs: Date.now() })
    expect(again?.stopReason).toBe('reminder_create_awaiting_approval')
    expect(await reminders(o)).toHaveLength(1)
    expect(await db('agent_actions').where({ agencyId: A })).toHaveLength(1)
    expect(await db('wa_assistant_approvals').where({ recipientId: o.r })).toHaveLength(1)
    expect(again?.buttons?.[0].id).toBe(h.last().buttons![0].id)
  })

  it('after approval the same message reports the reminder, never a second one', async () => {
    const o = await owner(A)
    const h = harness()
    const c = await card(o, h, 'בעוד 5 דקות תזכיר לי להתקשר לאבי')
    const job = await lastJob(o)
    await press(o, h, c.approve)
    const again = await handleReminderMessage({ job, scope: scope(o), nowMs: Date.now() })
    expect(again).toMatchObject({ stopReason: 'reminder_already_scheduled' })
    expect(await reminders(o)).toHaveLength(1)
  })
})

describe('feature switch and delivery', () => {
  it('reminders switch off → the message goes to the Agent exactly as before, nothing is drafted', async () => {
    const o = await owner(OFF)
    const h = harness()
    await say(o, 'בעוד 5 דקות תזכיר לי להתקשר לאבי')
    await run(h)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
    expect(await db('owner_personal_reminders').where({ agencyId: OFF })).toHaveLength(0)
  })

  it('a CRM task request stays a task even with the switch on', async () => {
    const o = await owner(A)
    const h = harness()
    await say(o, 'תיצור משימה להתקשר לדני מחר')
    await run(h)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
    expect(await reminders(o)).toHaveLength(0)
  })

  it('an approved reminder is NOT delivered: the delivery tick is a dry run by default', async () => {
    const o = await owner(A)
    const h = harness()
    const c = await card(o, h, 'בעוד 5 דקות תזכיר לי להתקשר לאבי')
    await press(o, h, c.approve)
    const [row] = await reminders(o)
    const send = vi.fn()
    const s = await tickPersonalReminders({ send: send as never, nowMs: () => new Date(row.remindAt).getTime() + 1_000 })
    expect(s.mode).toBe('dry_run')
    expect(send).not.toHaveBeenCalled()
    expect((await reminders(o))[0].status).toBe('scheduled')
    // Even with the env switch set, the database controls are seeded disabled.
    process.env.OWNER_PERSONAL_REMINDERS_SEND_ENABLED = '1'
    const blocked = await tickPersonalReminders({ send: send as never, nowMs: () => new Date(row.remindAt).getTime() + 1_000 })
    expect(blocked.mode).toBe('blocked')
    expect(send).not.toHaveBeenCalled()
  })
})
