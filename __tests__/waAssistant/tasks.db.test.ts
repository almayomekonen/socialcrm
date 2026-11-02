import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tasks and follow-ups from WhatsApp, against a real (local test) PostgreSQL
 * and the REAL Action Runtime (submitProposedAction / decideOnAction / the
 * create_task and create_follow_up executors). Only the model and Meta are
 * mocked; nothing leaves the test database.
 *
 * NOTE: over the 250-line soft limit on purpose, like meetings.db.test.ts: one
 * flat list of independent scenarios over one shared harness.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/flags')>()),
  isAgentEnabled: () => flags.agent,
}))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { businessDateString, businessInstantMs } from '@/lib/today/time'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { hebrewDateLabel, parseHebrewWhen } from '@/lib/waAssistant/meetings/when'
import { TASK_COPY } from '@/lib/waAssistant/tasks/copy'
import { opensRequest } from '@/lib/waAssistant/request'
import { COPY, NO_ACTIONS_NOTE } from '@/lib/waAssistant/render'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

let A: number
let B: number
let seq = 0
const MIN = 60_000
const day = (words: string) => parseHebrewWhen(words, Date.now()).date!

type Owner = { u: number; r: number; digits: string; lead: number }

async function lead(agencyId: number, ownerUserId: number, firstName = 'דני', lastName = 'כהן') {
  const [c] = await db('clients')
    .insert({ firstName, lastName, agencyId, userId: ownerUserId, createdById: ownerUserId, lead: true })
    .returning('id')
  return Number(c.id)
}
async function owner(role = 'ADMIN', agencyId = A): Promise<Owner> {
  const u = await user(agencyId, role)
  const digits = `9725000072${String(++seq).padStart(2, '0')}`
  const r = await recipient(agencyId, u, digits, undefined, 'v4')
  return { u, r, digits, lead: await lead(agencyId, u) }
}

type Proposal =
  | { actionType: 'create_task'; args: { clientId: number; title: string; dueDate: string } }
  | { actionType: 'create_follow_up'; args: { clientId: number; at: string; note?: string | null } }
const answer = (p: Proposal | null, evidenceLeads: number[]) => ({
  ok: true as const,
  answer: {
    headline: 'ביקשתי',
    claims: [],
    unknown: null,
    proposedAction: p ? { ...p, evidenceRefs: evidenceLeads.map((l) => `lead:${l}`) } : null,
  },
  evidence: evidenceLeads.map((l) => ({ kind: 'lead', refId: String(l) })),
  steps: 2,
  stopReason: 'answered' as const,
  investigationId: `inv_wa_tk_${++seq}`,
  costUsd: 0.01,
})
const task = (clientId: number, dueDate = day('מחר'), title = 'לחזור לדני') => ({
  actionType: 'create_task' as const,
  args: { clientId, title, dueDate },
})
const followUp = (clientId: number, at = day('מחר'), note: string | null = 'לחזור') => ({
  actionType: 'create_follow_up' as const,
  args: { clientId, at, note },
})

function harness(results: unknown[] = []) {
  const runAgent = vi.fn(async () => results.shift() as never)
  const sendText = vi.fn(async (_i: Record<string, any>) => ({ kind: 'sent' as const, wamid: `wamid.TK_${++seq}` }))
  const deps = { runAgent: runAgent as never, sendText: sendText as never, typing: (async () => undefined) as never }
  const last = () => sendText.mock.calls.at(-1)![0] as { body: string; buttons?: { id: string; title: string }[]; toE164: string }
  return { runAgent, sendText, deps, last }
}
async function say(o: Owner, body: string) {
  expect(
    await processPlatformMessage({
      id: `wamid.__wa_tk_${++seq}`,
      from: o.digits,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: 'text',
      text: { body },
    }),
  ).toBe('assistant_queued')
}
const tap = (digits: string, buttonId: string) =>
  processPlatformMessage({
    id: `wamid.__wa_tk_${++seq}`,
    from: digits,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'x' } },
  })
const run = (h: ReturnType<typeof harness>, now?: () => Date) => runWaAssistantWorker({}, { ...h.deps, ...(now ? { now } : {}) })
const tasksOf = (clientId: number) => db('tasks').where({ clientId })
const followUpOf = async (clientId: number) =>
  (await db('clients')
    .where({ id: clientId })
    .first(db.raw(`to_char("nextFollowUpAt" AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') as at`), 'followUpNote')) as {
    at: string | null
    followUpNote: string | null
  }
const actionsOf = (agencyId: number) => db('agent_actions').where({ agencyId })

/** Ask, and return the card's button ids. */
async function card(o: Owner, h: ReturnType<typeof harness>, words: string) {
  await say(o, words)
  await run(h)
  const sent = h.last()
  expect(sent.buttons).toHaveLength(2)
  return { approve: sent.buttons![0].id, reject: sent.buttons![1].id, body: sent.body, titles: sent.buttons!.map((b) => b.title) }
}

beforeAll(async () => {
  A = await agency('__wa_tk_a__')
  B = await agency('__wa_tk_b__')
})
beforeEach(async () => {
  await resetBetweenTests()
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  await db('analytics_events').where({ event: 'wa_assistant_turn' }).del()
  await db('agencies')
    .whereIn('id', [A, B])
    .update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
  flags.agent = true
  process.env.WA_ASSISTANT_AGENCY_IDS = `${A},${B}`
  process.env.WA_ASSISTANT_TASKS_AGENCY_IDS = `${A},${B}`
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = `${A},${B}`
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
  process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
})
afterAll(async () => {
  for (const k of [
    'WA_ASSISTANT_AGENCY_IDS',
    'WA_ASSISTANT_TASKS_AGENCY_IDS',
    'OWNER_WA_REMINDERS_AGENCY_IDS',
    'PLATFORM_WHATSAPP_PHONE_NUMBER_ID',
    'PLATFORM_WHATSAPP_ACCESS_TOKEN',
  ])
    delete process.env[k]
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  await db('analytics_events').where({ event: 'wa_assistant_turn' }).del()
  await db('tasks')
    .whereIn('clientId', db('clients').whereIn('agencyId', [A, B]).select('id'))
    .del()
  await db('clients').whereIn('agencyId', [A, B]).del()
  await cleanup()
})

describe('creating, only after approval', () => {
  it('task: "תפתח משימת מעקב לליד הזה מחר" → card → nothing yet → approve → the task exists, once', async () => {
    const o = await owner()
    const h = harness([answer(task(o.lead), [o.lead])])
    const c = await card(o, h, 'תפתח משימת מעקב לליד הזה מחר')
    expect(c.titles).toEqual(['לאשר וליצור', 'ביטול'])
    expect(c.body).toContain('*ליצור משימה?*')
    expect(c.body).toContain('דני כהן')
    expect(await tasksOf(o.lead)).toHaveLength(0)

    expect(await tap(o.digits, c.approve)).toBe('assistant_queued')
    await run(h)
    expect(h.last().body).toContain('*המשימה נוצרה ב-SocialCRM*')
    expect(await tasksOf(o.lead).select('title', 'userId', db.raw(`to_char("dueDate", 'YYYY-MM-DD') as "dueDate"`))).toEqual([
      { title: 'לחזור לדני', userId: o.u, dueDate: day('מחר') },
    ])
  })

  it('follow-up: "תזכיר לי לחזור לדני מחר" → card → approve → the lead\'s follow-up is set', async () => {
    const o = await owner()
    const h = harness([answer(followUp(o.lead), [o.lead])])
    const c = await card(o, h, 'תזכיר לי לחזור לדני מחר')
    expect(c.titles).toEqual(['לאשר ולקבוע', 'ביטול'])
    expect((await followUpOf(o.lead)).at).toBeNull()
    await tap(o.digits, c.approve)
    await run(h)
    expect(h.last().body).toContain('*המעקב נקבע ב-SocialCRM*')
    expect(await followUpOf(o.lead)).toEqual({ at: day('מחר'), followUpNote: 'לחזור' })
  })

  it('"ביטול" creates nothing', async () => {
    const o = await owner()
    const h = harness([answer(task(o.lead), [o.lead])])
    const c = await card(o, h, 'תפתח משימה לדני מחר')
    await tap(o.digits, c.reject)
    await run(h)
    expect(h.last().body).toBe(TASK_COPY.rejected)
    expect(await tasksOf(o.lead)).toHaveLength(0)
  })

  it('a typed "כן" while a card is open points at the button; it never approves', async () => {
    const o = await owner()
    const h = harness([answer(task(o.lead), [o.lead])])
    await card(o, h, 'תפתח משימה לדני מחר')
    await say(o, 'כן')
    await run(h)
    expect(h.last().body).toBe(TASK_COPY.useButtons)
    expect(await tasksOf(o.lead)).toHaveLength(0)
  })
})

describe("Hebrew dates from the owner's own words", () => {
  it('"בעוד שלושה ימים" is read deterministically and must equal the Agent\'s day', async () => {
    const o = await owner()
    const h = harness([answer(task(o.lead, day('בעוד שלושה ימים'), 'לבדוק את ההצעה'), [o.lead])])
    const c = await card(o, h, 'תזכיר לי לבדוק את ההצעה בעוד שלושה ימים')
    expect(c.body).toContain('לבדוק את ההצעה')
  })

  it('the owner\'s day wins over the Agent\'s arithmetic: "מחר" is tomorrow, whatever the Agent proposed', async () => {
    const o = await owner()
    const h = harness([answer(followUp(o.lead, day('מחרתיים')), [o.lead])])
    const c = await card(o, h, 'תזכיר לי לחזור לדני מחר')
    expect(c.body).toContain(hebrewDateLabel(day('מחר')))
    await tap(o.digits, c.approve)
    await run(h)
    expect((await followUpOf(o.lead)).at).toBe(day('מחר'))
  })

  it.each([
    ['the owner gave two days', 'תזכיר לי לחזור לדני מחר או בעוד שבוע', () => day('מחר'), 'לאיזה יום בדיוק?'],
    [
      'the owner gave an hour that could be morning or afternoon',
      'תזכיר לי לחזור לדני מחר ב-4',
      () => day('מחר'),
      'ב-4 בבוקר או אחר הצהריים?',
    ],
  ])('%s → one question, nothing recorded', async (_l, words, agentDay, expected) => {
    const o = await owner()
    const h = harness([answer(followUp(o.lead, agentDay()), [o.lead])])
    await say(o, words)
    await run(h)
    expect(h.last()).toMatchObject({ body: expected })
    expect(h.last().buttons).toBeUndefined()
    expect(await actionsOf(A)).toHaveLength(0)
  })
})

describe('a conversation, not a form', () => {
  // A fixed morning, so "today at 12:00" is ahead of the clock whenever this runs. Only Date is faked.
  const today = () => businessDateString(Date.now())
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(businessInstantMs(businessDateString(Date.now()), '10:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  const asks = (headline: string) => ({
    ...answer(null, []),
    answer: { headline, claims: [], unknown: null, proposedAction: null },
  })
  const bodies = (h: ReturnType<typeof harness>) => h.sendText.mock.calls.map((c) => (c[0] as { body: string }).body)

  it('the reported conversation: the lead, then the time → a card for today at once, the time kept in the task', async () => {
    const o = await owner()
    const oren = await lead(A, o.u, 'Oren', 'Kakun')
    const otherOren = await lead(A, o.u, 'Oren', 'Levi')
    const call = () => answer(task(oren, today(), 'להתקשר לאורן'), [oren, otherOren])
    const h = harness([asks('לאיזה ליד?'), asks('מה לעשות?'), call()])

    await say(o, 'תיצור לי משימה ומעקב מתוך הוואטסאפ')
    await run(h)
    expect(h.last().body).toContain('לאיזה ליד?')
    await say(o, 'Oren kakun')
    await run(h)
    await say(o, 'לשעה 12:00 להתקשר לאורן')
    await run(h)

    const c = h.last()
    expect(c.buttons).toHaveLength(2)
    expect(c.body).toContain('Oren Kakun')
    expect(c.body).toContain(`${hebrewDateLabel(today())}, בשעה 12:00`)
    expect(bodies(h).filter((b) => b.includes('לאיזה ליד'))).toHaveLength(1)
    expect(await tasksOf(oren)).toHaveLength(0)

    await tap(o.digits, c.buttons![0].id)
    await run(h)
    expect(h.last().body).toContain('*המשימה נוצרה ב-SocialCRM*')
    expect(await tasksOf(oren).select('title', db.raw(`to_char("dueDate", 'YYYY-MM-DD') as "dueDate"`))).toEqual([
      { title: 'להתקשר לאורן בשעה 12:00', dueDate: today() },
    ])
  })

  it.each([
    ['תיצור משימה להתקשר לדני', task],
    ['תעשה לי מעקב עם דני', followUp],
  ])('no day named: "%s" → a card for today, with no question', async (words, make) => {
    const o = await owner()
    const h = harness([answer(make(o.lead, day('מחרתיים')), [o.lead])])
    const c = await card(o, h, words)
    expect(c.body).toContain(hebrewDateLabel(today()))
    expect(h.sendText).toHaveBeenCalledTimes(1)
    expect(await actionsOf(A)).toHaveLength(1)
  })

  it('a time already passed today: asks about tomorrow, records nothing; "כן" → a card for tomorrow at that time', async () => {
    const o = await owner()
    const h = harness([
      answer(task(o.lead, today(), 'להתקשר לדני'), [o.lead]),
      answer(task(o.lead, today(), 'להתקשר לדני'), [o.lead]),
    ])
    await say(o, 'תיצור משימה להתקשר לדני בשעה 09:00')
    await run(h)
    expect(h.last().body).toBe('השעה 09:00 היום כבר עברה. למחר באותה שעה?')
    expect(await actionsOf(A)).toHaveLength(0)

    const c = await card(o, h, 'כן')
    expect(c.body).toContain(`${hebrewDateLabel(day('מחר'))}, בשעה 09:00`)
  })

  it('an explicit day wins over the today default', async () => {
    const o = await owner()
    const h = harness([answer(task(o.lead, today(), 'להתקשר לדני'), [o.lead])])
    const c = await card(o, h, 'תיצור משימה להתקשר לדני מחר')
    expect(c.body).toContain(hebrewDateLabel(day('מחר')))
  })

  it('"מחר ב-12 להתקשר לדני" as a follow-up: the day is the follow-up, the time is in its note', async () => {
    const o = await owner()
    const h = harness([answer(followUp(o.lead, day('מחר'), 'להתקשר לדני'), [o.lead])])
    const c = await card(o, h, 'תקבע מעקב מחר ב-12 להתקשר לדני')
    expect(c.body).toContain(`${hebrewDateLabel(day('מחר'))}, בשעה 12:00`)
    await tap(o.digits, c.approve)
    await run(h)
    expect(await followUpOf(o.lead)).toEqual({ at: day('מחר'), followUpNote: 'להתקשר לדני בשעה 12:00' })
  })

  it('"ב-4" then "אחר הצהריים": one question, then a card at 16:00', async () => {
    const o = await owner()
    const h = harness([
      answer(task(o.lead, day('מחר'), 'להתקשר לדני'), [o.lead]),
      answer(task(o.lead, day('מחר'), 'להתקשר לדני'), [o.lead]),
    ])
    await say(o, 'תפתח משימה להתקשר לדני מחר ב-4')
    await run(h)
    expect(h.last().body).toBe('ב-4 בבוקר או אחר הצהריים?')
    const c = await card(o, h, 'אחר הצהריים')
    expect(c.body).toContain('בשעה 16:00')
  })

  it('the owner said "מעקב" but the Agent proposed a task: a follow-up card, with the same wording', async () => {
    const o = await owner()
    const h = harness([answer(task(o.lead, day('מחר'), 'לחזור לדני'), [o.lead])])
    const c = await card(o, h, 'תקבע מעקב לדני מחר')
    expect(c.titles).toEqual(['לאשר ולקבוע', 'ביטול'])
    await tap(o.digits, c.approve)
    await run(h)
    expect(await followUpOf(o.lead)).toEqual({ at: day('מחר'), followUpNote: 'לחזור לדני' })
    expect(await tasksOf(o.lead)).toHaveLength(0)
  })

  it('an unrelated earlier message never lends its day or time to a new request', async () => {
    const o = await owner()
    const h = harness([asks('יש לך 2 לידים חדשים מחר.'), answer(followUp(o.lead, day('מחר')), [o.lead])])
    await say(o, 'מה קורה מחר ב-12?')
    await run(h)
    const c = await card(o, h, 'תזכיר לי לחזור לדני')
    expect(c.body).toContain(hebrewDateLabel(today()))
    expect(c.body).not.toContain('בשעה 12:00')
  })

  it('a finished request never lends its day to the next one', async () => {
    const o = await owner()
    const h = harness([answer(task(o.lead), [o.lead]), answer(task(o.lead, today(), 'לבדוק הצעה'), [o.lead])])
    await card(o, h, 'תפתח משימה לדני מחר')
    const c = await card(o, h, 'תפתח משימה לבדוק הצעה לדני')
    expect(c.body).toContain(hebrewDateLabel(today()))
  })
})

describe('a new request starts clean; only an answer continues', () => {
  const today = () => businessDateString(Date.now())
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(businessInstantMs(businessDateString(Date.now()), '10:00'))
    process.env.WA_ASSISTANT_MEETINGS_AGENCY_IDS = `${A},${B}`
  })
  afterEach(() => {
    vi.useRealTimers()
    delete process.env.WA_ASSISTANT_MEETINGS_AGENCY_IDS
  })
  const meeting = (clientId: number, date = day('מחר'), startTime = '12:00') => ({
    actionType: 'create_meeting' as const,
    args: { clientId, title: 'פגישה', date, startTime, durationMinutes: 60, note: null },
  })
  /** The earlier turns the Agent was handed, nothing else (its fixed rules mention example names). */
  const agentSaw = (h: ReturnType<typeof harness>) =>
    JSON.stringify(((h.runAgent.mock.calls.at(-1) as unknown[])[0] as { history: unknown }).history)
  const meetingsOf = (clientId: number) => db('meetings').where({ lead_id: clientId })

  it('a meeting with one lead waiting for a time, then a task for another: nothing carries over', async () => {
    const o = await owner()
    const avi = await lead(A, o.u, 'אבי', 'לוי')
    const ron = await lead(A, o.u, 'רון', 'ברק')
    const h = harness([answer(meeting(avi) as never, [avi]), answer(task(ron, day('מחר'), 'להתקשר לרון'), [ron])])
    await say(o, 'תקבע פגישה עם אבי לוי מחר')
    await run(h)
    expect(h.last().body).toBe('באיזו שעה?')

    const c = await card(o, h, 'תיצור משימה להתקשר לרון ברק')
    expect(c.titles).toEqual(['לאשר וליצור', 'ביטול'])
    expect(c.body).toContain('רון ברק')
    expect(c.body).not.toContain('אבי')
    expect(c.body).toContain(hebrewDateLabel(today())) // not the abandoned "מחר"
    // The Agent is not handed the abandoned request either.
    expect(agentSaw(h)).not.toContain('אבי')

    await tap(o.digits, c.approve)
    await run(h)
    expect(await tasksOf(ron).select('title', db.raw(`to_char("dueDate", 'YYYY-MM-DD') as "dueDate"`))).toEqual([
      { title: 'להתקשר לרון', dueDate: today() },
    ])
    expect(await tasksOf(avi)).toHaveLength(0)
    expect(await meetingsOf(avi)).toHaveLength(0)
  })

  it("an abandoned meeting's time and action never reach the new task", async () => {
    const o = await owner()
    const avi = await lead(A, o.u, 'אבי', 'לוי')
    const ron = await lead(A, o.u, 'רון', 'ברק')
    const h = harness([answer(meeting(avi) as never, [avi]), answer(followUp(ron, today(), 'לחזור לרון'), [ron])])
    await say(o, 'תקבע פגישה עם אבי לוי מחר או מחרתיים ב-12:00')
    await run(h)
    expect(h.last().body).toBe('לאיזה יום בדיוק?')

    const c = await card(o, h, 'תקבע מעקב לרון ברק')
    expect(c.titles).toEqual(['לאשר ולקבוע', 'ביטול'])
    expect(c.body).not.toContain('12:00')
    expect(c.body).toContain(hebrewDateLabel(today()))
    await tap(o.digits, c.approve)
    await run(h)
    expect(await followUpOf(ron)).toEqual({ at: today(), followUpNote: 'לחזור לרון' })
  })

  it("from a task to a meeting: the task's day does not carry over", async () => {
    const o = await owner()
    const ron = await lead(A, o.u, 'רון', 'ברק')
    const h = harness([
      answer(task(o.lead, day('מחר'), 'להתקשר לדני'), [o.lead]),
      answer(meeting(ron, day('מחר'), '15:00') as never, [ron]),
    ])
    await say(o, 'תיצור משימה להתקשר לדני מחר ב-4')
    await run(h)
    expect(h.last().body).toBe('ב-4 בבוקר או אחר הצהריים?')
    const c = await card(o, h, 'תקבע פגישה עם רון ברק בשעה 15:00')
    expect(c.body).toContain('רון ברק')
    expect(c.body).toContain(hebrewDateLabel(today()))
  })

  it('a second abandoned request: the answer belongs to the newest one only', async () => {
    const o = await owner()
    const avi = await lead(A, o.u, 'אבי', 'לוי')
    const h = harness([
      answer(meeting(avi, day('מחרתיים')) as never, [avi]),
      answer(task(o.lead, today(), 'להתקשר לדני'), [o.lead]),
      answer(task(o.lead, today(), 'להתקשר לדני'), [o.lead]),
    ])
    await say(o, 'תקבע פגישה עם אבי לוי מחרתיים')
    await run(h)
    await say(o, 'תיצור משימה להתקשר לדני ב-4')
    await run(h)
    expect(h.last().body).toBe('ב-4 בבוקר או אחר הצהריים?')
    const c = await card(o, h, 'אחר הצהריים')
    expect(c.body).toContain('דני כהן')
    expect(c.body).toContain(`${hebrewDateLabel(today())}, בשעה 16:00`)
  })

  it('the same action for another lead: a new task inherits nothing from the abandoned task', async () => {
    const o = await owner()
    const ron = await lead(A, o.u, 'רון', 'ברק')
    const h = harness([
      answer(task(o.lead, day('מחר'), 'להתקשר לדני'), [o.lead]),
      answer(task(ron, day('מחר'), 'להתקשר לרון'), [ron]),
    ])
    await say(o, 'תיצור משימה להתקשר לדני מחרתיים ב-4')
    await run(h)
    expect(h.last().body).toBe('ב-4 בבוקר או אחר הצהריים?')
    const c = await card(o, h, 'תיצור משימה להתקשר לרון ברק')
    expect(c.body).toContain('רון ברק')
    expect(c.body).toContain(hebrewDateLabel(today()))
    expect(c.body).not.toContain('בשעה')
    expect(agentSaw(h)).not.toContain('להתקשר לדני')
  })

  it('two abandoned tasks: the answer reads back only to the newest, never its older day', async () => {
    const o = await owner()
    const ron = await lead(A, o.u, 'רון', 'ברק')
    const h = harness([
      answer(task(o.lead, day('מחרתיים'), 'להתקשר לדני'), [o.lead]),
      answer(task(ron, today(), 'להתקשר לרון'), [ron]),
      answer(task(ron, today(), 'להתקשר לרון'), [ron]),
    ])
    await say(o, 'תיצור משימה להתקשר לדני מחרתיים ב-3')
    await run(h)
    await say(o, 'תיצור משימה להתקשר לרון ברק ב-4')
    await run(h)
    const c = await card(o, h, 'אחר הצהריים')
    expect(c.body).toContain('רון ברק')
    expect(c.body).toContain(`${hebrewDateLabel(today())}, בשעה 16:00`)
  })

  it('answering a pending question still continues, even with a verb: "תקבע ב-11" answers "באיזו שעה?"', async () => {
    const o = await owner()
    const avi = await lead(A, o.u, 'אבי', 'לוי')
    const h = harness([answer(meeting(avi) as never, [avi]), answer(meeting(avi, day('מחר'), '11:00') as never, [avi])])
    await say(o, 'תקבע פגישה עם אבי לוי מחר')
    await run(h)
    expect(h.last().body).toBe('באיזו שעה?')
    const c = await card(o, h, 'תקבע ב-11')
    expect(c.body).toContain(hebrewDateLabel(day('מחר')))
    expect(c.body).toContain('11:00–12:00')
    expect(agentSaw(h)).toContain('אבי')
  })

  it('pointing back keeps the conversation for the Agent, but not the old day: "תפתח משימה לליד הזה"', async () => {
    const o = await owner()
    const h = harness([
      answer(task(o.lead, day('מחר'), 'להתקשר לדני'), [o.lead]),
      answer(task(o.lead, today(), 'לבדוק הצעה'), [o.lead]),
    ])
    await say(o, 'תיצור משימה להתקשר לדני מחר ב-4')
    await run(h)
    const c = await card(o, h, 'תפתח משימה לבדוק הצעה לליד הזה')
    expect(agentSaw(h)).toContain('להתקשר לדני')
    expect(c.body).toContain(hebrewDateLabel(today()))
  })

  it.each([
    ['תיצור משימה לרון', true],
    ['תקבע פגישה עם רון', true],
    ['תקבע מעקב לרון', true],
    ['תזכיר לי לחזור לרון', true],
    ['תפתח משימת מעקב', true],
    ['לפגישה עם רון', true],
    ['Oren kakun', false],
    ['לשעה 12:00 להתקשר לאורן', false],
    ['מחר', false],
    ['ב-11', false],
    ['תקבע ב-11', false],
    ['השני', false],
    ['כן', false],
    ['מעקב', false],
    ['משימה', false],
  ])('"%s" opens a new request: %s', (words, expected) => {
    expect(opensRequest(words)).toBe(expected)
  })
})

describe('which lead', () => {
  const phone = (id: number, value: string) => db('clients').where({ id }).update({ phone: value })

  it('two leads with the same name: one question with the phone\'s last digits, nothing recorded; "2" → the card', async () => {
    const o = await owner()
    const same = await lead(A, o.u)
    await phone(o.lead, '0501112222')
    await phone(same, '0503334444')
    const h = harness([answer(followUp(o.lead), [o.lead, same]), answer(followUp(o.lead), [o.lead, same])])
    await say(o, 'תזכיר לי לחזור לדני כהן מחר')
    await run(h)
    expect(h.last().body).toContain('טלפון שמסתיים ב-2222')
    expect(h.last().body).toContain('טלפון שמסתיים ב-4444')
    expect(h.last().body).not.toContain('0501112222')
    expect(h.last().buttons).toBeUndefined()
    expect(await actionsOf(A)).toHaveLength(0)

    const c = await card(o, h, '2')
    await tap(o.digits, c.approve)
    await run(h)
    expect((await followUpOf(same)).at).toBe(day('מחר'))
    expect((await followUpOf(o.lead)).at).toBeNull()
  })

  it("the owner can answer with the phone's last digits; the day they gave is not asked again", async () => {
    const o = await owner()
    const other = await lead(A, o.u, 'דני', 'לוי')
    await phone(o.lead, '0505556666')
    await phone(other, '0507778888')
    const h = harness([answer(followUp(o.lead), [o.lead, other]), answer(followUp(o.lead), [o.lead, other])])
    await say(o, 'תזכיר לי לחזור לדני מחר')
    await run(h)
    expect(h.last().body).toContain('יש כמה לידים מתאימים')
    const c = await card(o, h, '8888')
    expect(c.body).toContain('דני לוי')
    expect(c.body).toContain(hebrewDateLabel(day('מחר')))
  })

  it('one full name among similar leads: no question', async () => {
    const o = await owner()
    const other = await lead(A, o.u, 'דני', 'לוי')
    const h = harness([answer(followUp(o.lead), [o.lead, other])])
    const c = await card(o, h, 'תזכיר לי לחזור לדני לוי מחר')
    expect(c.body).toContain('דני לוי')
  })

  it('a lead the Agent merely read, never named by the owner, does not cause a question', async () => {
    const o = await owner()
    const unrelated = await lead(A, o.u, 'מיכל', 'ברק')
    const h = harness([answer(followUp(o.lead), [o.lead, unrelated])])
    const c = await card(o, h, 'תזכיר לי לחזור לדני מחר')
    expect(c.body).toContain('דני כהן')
  })

  it("a colleague's same-named lead is never offered to a rep", async () => {
    const rep = await owner('AGNT')
    const colleague = await owner('AGNT')
    await phone(colleague.lead, '0509998888')
    const h = harness([answer(followUp(rep.lead), [rep.lead, colleague.lead])])
    await say(rep, 'תזכיר לי לחזור לדני כהן מחר')
    await run(h)
    expect(h.last().buttons).toHaveLength(2)
    expect(h.last().body).not.toContain('8888')
  })
})

describe('authorization and tenant isolation', () => {
  it("a rep cannot create a task on a colleague's lead (refused before anything is recorded)", async () => {
    const rep = await owner('AGNT')
    const colleague = await user(A, 'AGNT')
    const theirs = await lead(A, colleague, 'מיכל', 'כץ')
    const h = harness([answer(task(theirs), [theirs])])
    await say(rep, 'תפתח משימה למיכל מחר')
    await run(h)
    expect(h.last().body).toBe(TASK_COPY.leadNotAllowed)
    expect(await actionsOf(A)).toHaveLength(0)
    expect(await tasksOf(theirs)).toHaveLength(0)
  })

  it("another agency's lead is never readable, whatever id the Agent proposes", async () => {
    const o = await owner()
    const foreign = await lead(B, await user(B), 'זר', 'אחר')
    const h = harness([answer(task(foreign), [foreign])])
    await say(o, 'תפתח משימה מחר')
    await run(h)
    expect(h.last().body).toBe(TASK_COPY.leadNotAllowed)
    expect(await tasksOf(foreign)).toHaveLength(0)
  })

  it("another owner's tap on a card is not found, and creates nothing", async () => {
    const o = await owner()
    const intruder = await owner('ADMIN', B)
    const h = harness([answer(task(o.lead), [o.lead])])
    const c = await card(o, h, 'תפתח משימה לדני מחר')
    await tap(intruder.digits, c.approve)
    await run(h)
    expect(h.last().toE164).toBe(`+${intruder.digits}`)
    expect(h.last().body).toBe('לא מצאתי בקשה פתוחה לאשר.')
    expect(await tasksOf(o.lead)).toHaveLength(0)
  })
})

describe('single-use, expiring confirmation tokens', () => {
  it('a replayed approval creates exactly one task', async () => {
    const o = await owner()
    const h = harness([answer(task(o.lead), [o.lead])])
    const c = await card(o, h, 'תפתח משימה לדני מחר')
    await tap(o.digits, c.approve)
    await run(h)
    await tap(o.digits, c.approve)
    await run(h)
    expect(h.last().body).toBe(TASK_COPY.alreadyDecided)
    expect(await tasksOf(o.lead)).toHaveLength(1)
  })

  it('an approval after 15 minutes is expired and creates nothing', async () => {
    const o = await owner()
    const h = harness([answer(task(o.lead), [o.lead])])
    const c = await card(o, h, 'תפתח משימה לדני מחר')
    await tap(o.digits, c.approve)
    await run(h, () => new Date(Date.now() + 16 * MIN))
    expect(h.last().body).toBe(TASK_COPY.expired)
    expect(await tasksOf(o.lead)).toHaveLength(0)
  })

  it('a newer card supersedes the older one', async () => {
    const o = await owner()
    const h = harness([answer(task(o.lead), [o.lead]), answer(followUp(o.lead), [o.lead])])
    const first = await card(o, h, 'תפתח משימה לדני מחר')
    await card(o, h, 'תזכיר לי לחזור לדני מחר')
    await tap(o.digits, first.approve)
    await run(h)
    expect(h.last().body).toBe(TASK_COPY.superseded)
    expect(await tasksOf(o.lead)).toHaveLength(0)
  })
})

describe('access revoked between the card and the tap', () => {
  it.each([
    [
      'tasks switched off for the agency',
      async () => void (process.env.WA_ASSISTANT_TASKS_AGENCY_IDS = String(B)),
      COPY.notAvailable,
    ],
    [
      'assistant consent withdrawn',
      async (o: Owner) => db('owner_whatsapp_recipients').where({ id: o.r }).update({ consentTextVersion: 'v2' }),
      COPY.consentRequired,
    ],
    ['the Agent turned off', async () => void (flags.agent = false), COPY.notAvailable],
  ])('%s → nothing is created', async (_l, revoke, expected) => {
    const o = await owner()
    const h = harness([answer(task(o.lead), [o.lead])])
    const c = await card(o, h, 'תפתח משימה לדני מחר')
    await revoke(o as never)
    await tap(o.digits, c.approve)
    await run(h)
    expect(h.last().body).toBe(expected)
    expect(await tasksOf(o.lead)).toHaveLength(0)
  })

  it('a rep who lost access to the lead → the executor refuses; nothing is created', async () => {
    const rep = await owner('AGNT')
    const h = harness([answer(task(rep.lead), [rep.lead])])
    const c = await card(rep, h, 'תפתח משימה לדני מחר')
    const colleague = await user(A, 'AGNT')
    await db('clients').where({ id: rep.lead }).update({ userId: colleague, createdById: colleague })
    await tap(rep.digits, c.approve)
    await run(h)
    expect(h.last().body).toBe(TASK_COPY.notAuthorized)
    expect(await tasksOf(rep.lead)).toHaveLength(0)
  })

  it('a suspended user gets nothing, and nothing is created', async () => {
    const o = await owner()
    const h = harness([answer(task(o.lead), [o.lead])])
    const c = await card(o, h, 'תפתח משימה לדני מחר')
    await db('users').where({ id: o.u }).update({ suspended: true })
    const sent = h.sendText.mock.calls.length
    await tap(o.digits, c.approve)
    await run(h)
    expect(h.sendText.mock.calls.length).toBe(sent)
    expect(await tasksOf(o.lead)).toHaveLength(0)
  })
})

describe('off by default', () => {
  it('without WA_ASSISTANT_TASKS_AGENCY_IDS a proposal gets the read-only note, never a card', async () => {
    delete process.env.WA_ASSISTANT_TASKS_AGENCY_IDS
    const o = await owner()
    const h = harness([answer(task(o.lead), [o.lead])])
    await say(o, 'תפתח משימה לדני מחר')
    await run(h)
    expect(h.last().buttons).toBeUndefined()
    expect(h.last().body).toContain(NO_ACTIONS_NOTE)
    expect(await actionsOf(A)).toHaveLength(0)
  })
})
