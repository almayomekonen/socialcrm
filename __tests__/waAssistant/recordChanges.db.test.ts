import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Editing or completing an existing task, and moving or cancelling an existing
 * appointment, for a brand-new agency on no list, through the REAL worker and
 * Action Runtime. Only the model, Meta and Google are mocked.
 */
const flags = vi.hoisted(() => ({ agent: true }))
const google = vi.hoisted(() => ({
  updateEvent: vi.fn(async (_i: Record<string, unknown>) => ({ etag: 'e2', meetLink: null })),
  deleteEvent: vi.fn(async (_i: Record<string, unknown>) => undefined),
  connected: false,
}))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))
vi.mock('@/lib/integrations/google/calendarClient', async (orig) => ({ ...(await orig<object>()), updateEvent: google.updateEvent, deleteEvent: google.deleteEvent }))
vi.mock('@/db/googleCalendarConnections', async (orig) => ({
  ...(await orig<object>()),
  getCalendarConnectionByUserId: async () => (google.connected ? { sync_status: 'active', scope: 'https://www.googleapis.com/auth/calendar.events' } : null),
}))

import { db } from '@/config/db'
import { insertMeeting, getMeeting } from '@/db/meetings'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { parseHebrewWhen } from '@/lib/waAssistant/meetings/when'
import { businessInstantMs } from '@/lib/today/time'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

const OPEN = ['WA_ASSISTANT_AUDIENCE', 'OWNER_WA_REMINDERS_AUDIENCE', 'WA_ASSISTANT_TASKS_AUDIENCE', 'WA_ASSISTANT_MEETINGS_AUDIENCE']
const TABLES = ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']

let seq = 0
const day = (w: string) => parseHebrewWhen(w, Date.now()).date!
const at = (w: string, time: string) => new Date(businessInstantMs(day(w), time))
type Owner = { agencyId: number; u: number; digits: string; lead: number }

async function lead(agencyId: number, u: number, firstName = 'דני') {
  const [c] = await db('clients').insert({ firstName, lastName: 'כהן', agencyId, userId: u, createdById: u, lead: true, status: 'new' }).returning('id')
  return Number(c.id)
}
async function owner(role = 'ADMIN'): Promise<Owner> {
  const agencyId = await agency(`__rc_${Date.now()}_${++seq}__`)
  await db('agencies').where({ id: agencyId }).update({ plan: 'pro', planReason: 'manual:test', trialExempt: false })
  const u = await user(agencyId, role)
  const digits = `9725001${String(70000 + ++seq).padStart(5, '0')}`
  await recipient(agencyId, u, digits, undefined, 'v4')
  return { agencyId, u, digits, lead: await lead(agencyId, u) }
}
const task = async (clientId: number, u: number, title: string, dueDate = day('מחר')) => {
  const [r] = await db('tasks').insert({ clientId, userId: u, title, dueDate, status: 'חדש', completed: false }).returning('id')
  return Number(r.id)
}
const meeting = (o: Owner, startAt: Date, title = 'פגישה עם דני', organizer = o.u) =>
  insertMeeting({ agencyId: o.agencyId, organizerUserId: organizer, leadId: o.lead, title, description: null, location: null, timezone: 'Asia/Jerusalem', startAt, endAt: new Date(startAt.getTime() + 45 * 60_000) })

const agentSays = (p: Record<string, unknown> | null, id: number) => ({
  ok: true as const,
  answer: { headline: 'בסדר', claims: [{ claimClass: 'FACT', text: 'דני כהן נמצא', entityEvidence: [`lead:${id}`] }], unknown: null, proposedAction: p ? { evidenceRefs: [`lead:${id}`], ...p } : null, proposedBatch: null },
  evidence: [{ kind: 'lead', refId: String(id) }],
  steps: 2,
  stopReason: 'answered' as const,
  investigationId: `inv_rc_${++seq}`,
  costUsd: 0.01,
})
function harness(results: unknown[]) {
  const runAgent = vi.fn(async () => results.shift() as never)
  const sendText = vi.fn(async (_i: Record<string, any>) => ({ kind: 'sent' as const, wamid: `wamid.RC_${++seq}` }))
  return { sendText, deps: { runAgent: runAgent as never, sendText: sendText as never, typing: (async () => undefined) as never }, last: () => sendText.mock.calls.at(-1)![0] }
}
type H = ReturnType<typeof harness>
const ts = () => String(Math.floor(Date.now() / 1000))
const say = async (o: Owner, body: string, h: H) => {
  expect(await processPlatformMessage({ id: `wamid.__rc_${++seq}`, from: o.digits, timestamp: ts(), type: 'text', text: { body } })).toBe('assistant_queued')
  await runWaAssistantWorker({}, h.deps)
  return h.last()
}
const tap = async (o: Owner, id: string, h: H) => {
  expect(await processPlatformMessage({ id: `wamid.__rc_${++seq}`, from: o.digits, timestamp: ts(), type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } })).toBe('assistant_queued')
  await runWaAssistantWorker({}, h.deps)
  return h.last()
}
const taskRow = (id: number) => db('tasks').where({ id }).first('title', 'completed', db.raw(`to_char("dueDate", 'YYYY-MM-DD') as "dueDate"`)) as Promise<{ title: string; completed: boolean; dueDate: string }>

beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})
beforeEach(async () => {
  await resetBetweenTests()
  for (const t of TABLES) await db(t).del()
  OPEN.forEach((k) => (process.env[k] = 'all'))
  flags.agent = true
  google.connected = false
  google.updateEvent.mockClear()
  google.deleteEvent.mockClear()
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
  process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
})
afterEach(() => OPEN.forEach((k) => delete process.env[k]))
afterAll(async () => {
  vi.restoreAllMocks()
  for (const t of TABLES) await db(t).del()
  const ours = db('agencies').where('name', 'like', '__rc_%').select('id')
  await db('agent_requests').whereIn('agencyId', ours).del()
  await db('analytics_events').whereIn('agencyId', ours).del()
  await db('analytics_events').where({ event: 'wa_assistant_turn' }).del()
  await db('meetings').whereIn('agency_id', ours).del()
  await db('tasks').whereIn('clientId', db('clients').whereIn('agencyId', ours).select('id')).del()
  await db('clients').whereIn('agencyId', ours).del()
  await cleanup()
})

describe('completing and editing an existing task', () => {
  it('marks a task complete only after approval, leaving one audited action and one counted request', async () => {
    process.env.CREDITS_METERING = '1'
    const o = await owner()
    const id = await task(o.lead, o.u, 'להתקשר לדני')
    const h = harness([agentSays({ actionType: 'complete_task', args: { clientId: o.lead, match: 'להתקשר' } }, o.lead)])
    const card = await say(o, 'תסמן שהמשימה להתקשר לדני בוצעה', h)
    expect(card.body).toContain('להתקשר לדני')
    expect(card.buttons).toHaveLength(2)
    expect((await taskRow(id)).completed).toBe(false)
    const done = await tap(o, card.buttons[0].id, h)
    expect(done.body).toContain('המשימה סומנה כבוצעה')
    expect((await taskRow(id)).completed).toBe(true)
    const actions = await db('agent_actions').where({ agencyId: o.agencyId })
    expect(actions).toHaveLength(1)
    expect(actions[0].actionType).toBe('complete_task')
    // The tap is the same request: approving a card is not a second one.
    expect(await db('agent_requests').where({ agencyId: o.agencyId })).toHaveLength(1)
    delete process.env.CREDITS_METERING
  })

  it('a replayed tap changes nothing further, and a rejection changes nothing at all', async () => {
    const o = await owner()
    const id = await task(o.lead, o.u, 'להתקשר לדני')
    const h = harness([agentSays({ actionType: 'complete_task', args: { clientId: o.lead, match: null } }, o.lead), agentSays({ actionType: 'update_task', args: { clientId: o.lead, match: null, newTitle: 'כותרת אחרת', newWhen: null } }, o.lead)])
    const card = await say(o, 'תסמן שהמשימה בוצעה', h)
    await tap(o, card.buttons[0].id, h)
    expect((await tap(o, card.buttons[0].id, h)).body).toContain('כבר טופלה')
    expect(await db('agent_actions').where({ agencyId: o.agencyId, actionType: 'complete_task' })).toHaveLength(1)

    await db('tasks').where({ id }).update({ completed: false })
    const edit = await say(o, 'תשנה את המשימה ל כותרת אחרת', h)
    expect((await tap(o, edit.buttons[1].id, h)).body).toContain('לא שיניתי')
    expect((await taskRow(id)).title).toBe('להתקשר לדני')
  })

  it('changes the date from the owner\'s own words and keeps the title', async () => {
    const o = await owner()
    const id = await task(o.lead, o.u, 'להתקשר לדני')
    const h = harness([agentSays({ actionType: 'update_task', args: { clientId: o.lead, match: 'להתקשר', newTitle: null, newWhen: 'מחרתיים' } }, o.lead)])
    const card = await say(o, 'תעביר את המשימה להתקשר לדני למחרתיים', h)
    await tap(o, card.buttons[0].id, h)
    expect(await taskRow(id)).toMatchObject({ title: 'להתקשר לדני', dueDate: day('מחרתיים') })
  })

  it('never takes a date the owner did not say', async () => {
    const o = await owner()
    const id = await task(o.lead, o.u, 'להתקשר לדני')
    const h = harness([agentSays({ actionType: 'update_task', args: { clientId: o.lead, match: null, newTitle: null, newWhen: 'בעוד שבועיים' } }, o.lead)])
    const reply = await say(o, 'תעדכן את המשימה של דני', h)
    expect(reply.body).toBe('מה לשנות במשימה?')
    expect(await db('agent_actions').where({ agencyId: o.agencyId })).toHaveLength(0)
    expect((await taskRow(id)).dueDate).toBe(day('מחר'))
  })

  it('asks which task when several fit, and "2" is the second line shown', async () => {
    const o = await owner()
    await task(o.lead, o.u, 'לשלוח הצעה', day('מחר'))
    const second = await task(o.lead, o.u, 'לשלוח חוזה', day('מחרתיים'))
    const propose = () => agentSays({ actionType: 'complete_task', args: { clientId: o.lead, match: 'לשלוח' } }, o.lead)
    const h = harness([propose(), propose()])
    const asked = await say(o, 'תסמן שהמשימה לשלוח לדני בוצעה', h)
    expect(asked.buttons ?? []).toHaveLength(0)
    expect(asked.body).toMatch(/1\. לשלוח הצעה[\s\S]*2\. לשלוח חוזה/u)
    expect(await db('agent_actions').where({ agencyId: o.agencyId })).toHaveLength(0)
    const card = await say(o, '2', h)
    expect(card.body).toContain('לשלוח חוזה')
    await tap(o, card.buttons[0].id, h)
    expect((await taskRow(second)).completed).toBe(true)
  })

  it('says so when a lead has no open task', async () => {
    const o = await owner()
    const h = harness([agentSays({ actionType: 'complete_task', args: { clientId: o.lead, match: null } }, o.lead)])
    expect((await say(o, 'תסמן שהמשימה בוצעה', h)).body).toContain('לא מצאתי משימה פתוחה')
  })

  it('does not overwrite a task edited after the card was sent', async () => {
    const o = await owner()
    const id = await task(o.lead, o.u, 'להתקשר לדני')
    const h = harness([agentSays({ actionType: 'update_task', args: { clientId: o.lead, match: null, newTitle: 'לשלוח מייל', newWhen: null } }, o.lead)])
    const card = await say(o, 'תשנה את המשימה ל לשלוח מייל', h)
    await db('tasks').where({ id }).update({ title: 'מישהו שינה' })
    expect((await tap(o, card.buttons[0].id, h)).body).toContain('השתנתה')
    expect((await taskRow(id)).title).toBe('מישהו שינה')
  })
})

describe('moving and cancelling an existing appointment', () => {
  it('moves it after approval, keeps its length, and tells Google without notifying anyone', async () => {
    const o = await owner()
    const id = await meeting(o, at('מחר', '10:00'))
    await db('meetings').where({ id }).update({ google_event_id: 'g1' })
    google.connected = true
    const h = harness([agentSays({ actionType: 'reschedule_meeting', args: { clientId: o.lead, match: null, newWhen: 'מחרתיים ב-15:00' } }, o.lead)])
    const card = await say(o, 'תזיז את הפגישה עם דני למחרתיים ב-15:00', h)
    expect((await getMeeting(id, o.agencyId))!.start_at).toEqual(at('מחר', '10:00'))
    const done = await tap(o, card.buttons[0].id, h)
    expect(done.body).toContain('הפגישה הוזזה')
    const row = (await getMeeting(id, o.agencyId))!
    expect(new Date(row.start_at)).toEqual(at('מחרתיים', '15:00'))
    expect(new Date(row.end_at).getTime() - new Date(row.start_at).getTime()).toBe(45 * 60_000)
    expect(google.updateEvent).toHaveBeenCalledOnce()
    expect(google.updateEvent.mock.calls[0][0]).toMatchObject({ googleEventId: 'g1', sendUpdates: 'none' })
  })

  it('a time alone keeps the day, and its own slot is not a conflict', async () => {
    const o = await owner()
    const id = await meeting(o, at('מחר', '10:00'))
    const h = harness([agentSays({ actionType: 'reschedule_meeting', args: { clientId: o.lead, match: null, newWhen: 'ל-10:30' } }, o.lead)])
    const card = await say(o, 'תזיז את הפגישה עם דני ל-10:30', h)
    await tap(o, card.buttons[0].id, h)
    expect(new Date((await getMeeting(id, o.agencyId))!.start_at)).toEqual(at('מחר', '10:30'))
  })

  it('refuses a slot taken by another meeting, with no card', async () => {
    const o = await owner()
    await meeting(o, at('מחר', '10:00'))
    const other = await lead(o.agencyId, o.u, 'רון')
    await insertMeeting({ agencyId: o.agencyId, organizerUserId: o.u, leadId: other, title: 'אחרת', description: null, location: null, timezone: 'Asia/Jerusalem', startAt: at('מחרתיים', '15:00'), endAt: at('מחרתיים', '16:00') })
    const h = harness([agentSays({ actionType: 'reschedule_meeting', args: { clientId: o.lead, match: null, newWhen: 'מחרתיים ב-15:00' } }, o.lead)])
    const reply = await say(o, 'תזיז את הפגישה עם דני למחרתיים ב-15:00', h)
    expect(reply.buttons ?? []).toHaveLength(0)
    expect(await db('agent_actions').where({ agencyId: o.agencyId })).toHaveLength(0)
  })

  it('asks for the new time when the owner gave none', async () => {
    const o = await owner()
    await meeting(o, at('מחר', '10:00'))
    const h = harness([agentSays({ actionType: 'reschedule_meeting', args: { clientId: o.lead, match: null, newWhen: null } }, o.lead)])
    expect((await say(o, 'תזיז את הפגישה עם דני', h)).body).toBe('לאיזה מועד להזיז את הפגישה?')
  })

  it('cancels after approval, removes it from Google silently, and the keep button keeps it', async () => {
    const o = await owner()
    const id = await meeting(o, at('מחר', '10:00'))
    await db('meetings').where({ id }).update({ google_event_id: 'g2' })
    google.connected = true
    const cancelIt = () => agentSays({ actionType: 'cancel_meeting', args: { clientId: o.lead, match: null } }, o.lead)
    const h = harness([cancelIt(), cancelIt()])
    const first = await say(o, 'תבטל את הפגישה עם דני', h)
    expect(first.buttons[1].title).toBe('להשאיר את הפגישה')
    await tap(o, first.buttons[1].id, h)
    expect((await getMeeting(id, o.agencyId))!.status).toBe('scheduled')
    const second = await say(o, 'תבטל את הפגישה עם דני', h)
    expect((await tap(o, second.buttons[0].id, h)).body).toContain('הפגישה בוטלה')
    expect((await getMeeting(id, o.agencyId))!.status).toBe('cancelled')
    expect(google.deleteEvent.mock.calls[0][0]).toMatchObject({ googleEventId: 'g2', sendUpdates: 'none' })
  })

  it('tells two meetings apart by the day the owner names, and asks when they name none', async () => {
    const o = await owner()
    await meeting(o, at('מחר', '10:00'))
    const later = await meeting(o, at('מחרתיים', '10:00'))
    const h = harness([agentSays({ actionType: 'cancel_meeting', args: { clientId: o.lead, match: null } }, o.lead), agentSays({ actionType: 'cancel_meeting', args: { clientId: o.lead, match: 'מחרתיים' } }, o.lead)])
    expect((await say(o, 'תבטל את הפגישה עם דני', h)).body).toContain('לאיזו פגישה')
    const card = await say(o, 'את של מחרתיים', h)
    await tap(o, card.buttons[0].id, h)
    expect((await getMeeting(later, o.agencyId))!.status).toBe('cancelled')
  })

  it('does not cancel a meeting whose outcome was recorded after the card', async () => {
    const o = await owner()
    const id = await meeting(o, at('מחר', '10:00'))
    const h = harness([agentSays({ actionType: 'cancel_meeting', args: { clientId: o.lead, match: null } }, o.lead)])
    const card = await say(o, 'תבטל את הפגישה עם דני', h)
    await db('meetings').where({ id }).update({ status: 'completed' })
    expect((await tap(o, card.buttons[0].id, h)).body).toContain('השתנתה')
    expect((await getMeeting(id, o.agencyId))!.status).toBe('completed')
  })
})

describe('tenant isolation and permissions', () => {
  it('a rep can complete a task on their own lead', async () => {
    const o = await owner('AGNT')
    const id = await task(o.lead, o.u, 'להתקשר לדני')
    const h = harness([agentSays({ actionType: 'complete_task', args: { clientId: o.lead, match: null } }, o.lead)])
    const card = await say(o, 'תסמן שהמשימה בוצעה', h)
    await tap(o, card.buttons[0].id, h)
    expect((await taskRow(id)).completed).toBe(true)
  })

  it('cannot reach a lead in another agency, even if the model names it', async () => {
    const mine = await owner()
    const theirs = await owner()
    const id = await task(theirs.lead, theirs.u, 'להתקשר לדני')
    const h = harness([agentSays({ actionType: 'complete_task', args: { clientId: theirs.lead, match: null } }, theirs.lead)])
    expect((await say(mine, 'תסמן שהמשימה בוצעה', h)).body).toContain('לא מצאתי את הליד')
    expect((await taskRow(id)).completed).toBe(false)
    expect(await db('agent_actions').where({ agencyId: mine.agencyId })).toHaveLength(0)
  })

  it('a record id invented by the model is ignored: the record is resolved by the application', async () => {
    const mine = await owner()
    const theirs = await owner()
    const foreign = await task(theirs.lead, theirs.u, 'משימה זרה')
    const own = await task(mine.lead, mine.u, 'להתקשר לדני')
    const h = harness([agentSays({ actionType: 'complete_task', args: { clientId: mine.lead, match: null, taskId: foreign } }, mine.lead)])
    const card = await say(mine, 'תסמן שהמשימה בוצעה', h)
    await tap(mine, card.buttons[0].id, h)
    expect((await taskRow(foreign)).completed).toBe(false)
    expect((await taskRow(own)).completed).toBe(true)
  })

  it('a meeting organized by a colleague cannot be changed, even by an admin, as in the calendar', async () => {
    const o = await owner()
    const colleague = await user(o.agencyId, 'ADMIN')
    const id = await meeting(o, at('מחר', '10:00'), 'פגישה', colleague)
    const h = harness([agentSays({ actionType: 'cancel_meeting', args: { clientId: o.lead, match: null } }, o.lead)])
    expect((await say(o, 'תבטל את הפגישה עם דני', h)).body).toContain('לא מצאתי פגישה')
    expect((await getMeeting(id, o.agencyId))!.status).toBe('scheduled')
  })

  it('a rep may not change a task on a colleague\'s lead', async () => {
    const o = await owner('AGNT')
    const colleague = await user(o.agencyId, 'AGNT')
    const theirs = await lead(o.agencyId, colleague)
    const id = await task(theirs, colleague, 'להתקשר לדני')
    const h = harness([agentSays({ actionType: 'complete_task', args: { clientId: theirs, match: null } }, theirs)])
    await say(o, 'תסמן שהמשימה בוצעה', h)
    expect((await taskRow(id)).completed).toBe(false)
    expect(await db('agent_actions').where({ agencyId: o.agencyId })).toHaveLength(0)
  })
})
