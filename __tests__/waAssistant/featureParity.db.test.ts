import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A brand-new agency, on no list at all, gets the same assistant the founder
 * has, through the REAL worker and Action Runtime, and none of the founder's
 * commercial exemption. Only the model and Meta are mocked.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { parseHebrewWhen } from '@/lib/waAssistant/meetings/when'
import { REMINDER_COPY } from '@/lib/waAssistant/reminders/copy'
import { isAgentListMeetingsAgency } from '@/lib/flags/agentMeetingsFlags'
import { isWaAssistantMeetingsAgency, isWaAssistantNotesAgency, isWaAssistantRemindersAgency, isWaAssistantStatusAgency, isWaAssistantTasksAgency } from '@/lib/flags/waAssistantFlags'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

const OPEN = ['WA_ASSISTANT_MEETINGS_AUDIENCE', 'WA_ASSISTANT_TASKS_AUDIENCE', 'WA_ASSISTANT_STATUS_AUDIENCE', 'WA_ASSISTANT_NOTES_AUDIENCE', 'WA_ASSISTANT_REMINDERS_AUDIENCE']
const IDS = ['WA_ASSISTANT_MEETINGS_AGENCY_IDS', 'WA_ASSISTANT_TASKS_AGENCY_IDS', 'WA_ASSISTANT_STATUS_AGENCY_IDS', 'WA_ASSISTANT_NOTES_AGENCY_IDS', 'WA_ASSISTANT_REMINDERS_AGENCY_IDS']
const GATES = [isWaAssistantMeetingsAgency, isWaAssistantTasksAgency, isWaAssistantStatusAgency, isWaAssistantNotesAgency, isWaAssistantRemindersAgency]
const OTHER = ['WA_ASSISTANT_AUDIENCE', 'WA_ASSISTANT_AGENCY_IDS', 'WA_ASSISTANT_EXCLUDED_AGENCY_IDS', 'AGENT_LIST_MEETINGS_AUDIENCE', 'AGENT_LIST_MEETINGS_AGENCY_IDS', 'OWNER_WA_REMINDERS_AUDIENCE', 'OWNER_WA_REMINDERS_AGENCY_IDS', 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'PLATFORM_WHATSAPP_ACCESS_TOKEN', 'CREDITS_METERING', 'CREDITS_MONTHLY_ALLOWANCE', 'CREDITS_ENFORCEMENT_AGENCY_IDS', 'CREDITS_ENFORCE_ON_PRO']
const clear = () => [...OPEN, ...IDS, ...OTHER].forEach((k) => delete process.env[k])
function openToEveryone() {
  process.env.WA_ASSISTANT_AUDIENCE = 'all'
  process.env.OWNER_WA_REMINDERS_AUDIENCE = 'all'
  OPEN.forEach((k) => (process.env[k] = 'all'))
}

let seq = 0
const NEW_AGENCY = () => `__fp_${Date.now()}_${++seq}__`
const day = (w: string) => parseHebrewWhen(w, Date.now()).date!
type Owner = { agencyId: number; u: number; digits: string; lead: number }
async function owner(consent = 'v4', role = 'ADMIN'): Promise<Owner> {
  const agencyId = await agency(NEW_AGENCY())
  await db('agencies').where({ id: agencyId }).update({ plan: 'pro', planReason: 'manual:test', trialExempt: false })
  const u = await user(agencyId, role)
  const digits = `9725000${String(70000 + ++seq).padStart(5, '0')}`
  await recipient(agencyId, u, digits, undefined, consent)
  const [c] = await db('clients').insert({ firstName: 'דני', lastName: 'כהן', agencyId, userId: u, createdById: u, lead: true, status: 'new' }).returning('id')
  return { agencyId, u, digits, lead: Number(c.id) }
}
const agentSays = (p: Record<string, unknown> | null, lead: number) => ({
  ok: true as const,
  answer: { headline: 'בסדר', claims: [{ claimClass: 'FACT', text: 'דני כהן נמצא', entityEvidence: [`lead:${lead}`] }], unknown: null, proposedAction: p ? { ...p, evidenceRefs: [`lead:${lead}`] } : null },
  evidence: [{ kind: 'lead', refId: String(lead) }],
  steps: 2,
  stopReason: 'answered' as const,
  investigationId: `inv_fp_${++seq}`,
  costUsd: 0.01,
})
function harness(results: unknown[] = []) {
  const runAgent = vi.fn(async (_i: Record<string, any>) => results.shift() as never)
  const sendText = vi.fn(async (_i: Record<string, any>) => ({ kind: 'sent' as const, wamid: `wamid.FP_${++seq}` }))
  return { runAgent, sendText, deps: { runAgent: runAgent as never, sendText: sendText as never, typing: (async () => undefined) as never }, last: () => sendText.mock.calls.at(-1)![0] as { body: string; buttons?: { id: string }[] } }
}
const ts = () => String(Math.floor(Date.now() / 1000))
const say = (o: Owner, body: string) => processPlatformMessage({ id: `wamid.__fp_${++seq}`, from: o.digits, timestamp: ts(), type: 'text', text: { body } })
const tap = (o: Owner, id: string) => processPlatformMessage({ id: `wamid.__fp_${++seq}`, from: o.digits, timestamp: ts(), type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } })
async function approve(o: Owner, h: ReturnType<typeof harness>, words: string) {
  expect(await say(o, words)).toBe('assistant_queued')
  await runWaAssistantWorker({}, h.deps)
  const card = h.last()
  expect(card.buttons).toHaveLength(2)
  expect(await tap(o, card.buttons![0].id)).toBe('assistant_queued')
  await runWaAssistantWorker({}, h.deps)
}

describe('who is offered each capability', () => {
  afterEach(clear)
  it('explicit lists keep working, feature by feature', () => {
    process.env.WA_ASSISTANT_AGENCY_IDS = '23,103'
    IDS.forEach((k) => (process.env[k] = '23'))
    for (const gate of GATES) {
      expect(gate(23)).toBe(true)
      expect(gate(103)).toBe(false)
    }
  })
  it('with the audience open, any agency, including one that does not exist yet', () => {
    openToEveryone()
    for (const gate of GATES) for (const id of [23, 999_999]) expect(gate(id)).toBe(true)
  })
  it('never beyond the assistant audience, and an excluded agency stays out', () => {
    OPEN.forEach((k) => (process.env[k] = 'all'))
    process.env.WA_ASSISTANT_AGENCY_IDS = '23'
    for (const gate of GATES) expect(gate(24)).toBe(false)
    process.env.WA_ASSISTANT_AUDIENCE = 'all'
    process.env.WA_ASSISTANT_EXCLUDED_AGENCY_IDS = '24'
    for (const gate of GATES) expect(gate(24)).toBe(false)
  })
  it('the word `all` in an id list means nothing: only the audience variable opens a capability', () => {
    process.env.WA_ASSISTANT_AUDIENCE = 'all'
    IDS.forEach((k) => (process.env[k] = 'all'))
    for (const gate of GATES) expect(gate(23)).toBe(false)
  })
  it('the Agent meetings tool follows the same rule', () => {
    expect(isAgentListMeetingsAgency(23)).toBe(false)
    process.env.AGENT_LIST_MEETINGS_AUDIENCE = 'all'
    expect(isAgentListMeetingsAgency(23)).toBe(true)
  })
})

describe('a new agency, on no list, through the real worker', () => {
  beforeAll(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })
  beforeEach(async () => {
    await resetBetweenTests()
    for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
    clear()
    openToEveryone()
    flags.agent = true
    process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
    process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
  })
  afterAll(async () => {
    clear()
    vi.restoreAllMocks()
    for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
    const ours = db('agencies').where('name', 'like', '__fp_%').select('id')
    await db('agent_requests').whereIn('agencyId', ours).del()
    await db('analytics_events').whereIn('agencyId', ours).del()
    await db('analytics_events').where({ event: 'wa_assistant_turn' }).del()
    await db('meetings').whereIn('agency_id', ours).del()
    await db('owner_personal_reminders').whereIn('agencyId', ours).del()
    await db('lead_notes').whereIn('agencyId', ours).del()
    await db('tasks').whereIn('clientId', db('clients').whereIn('agencyId', ours).select('id')).del()
    await db('clients').whereIn('agencyId', ours).del()
    await cleanup()
  })

  it('creates a task, after approval', async () => {
    const o = await owner()
    const h = harness([agentSays({ actionType: 'create_task', args: { clientId: o.lead, title: 'לחזור לדני', dueDate: day('מחר') } }, o.lead)])
    await approve(o, h, 'תפתח משימה לדני מחר')
    expect(await db('tasks').where({ clientId: o.lead })).toHaveLength(1)
  })

  it('sets a follow-up, after approval', async () => {
    const o = await owner()
    const h = harness([agentSays({ actionType: 'create_follow_up', args: { clientId: o.lead, at: day('מחר'), note: 'לחזור' } }, o.lead)])
    await approve(o, h, 'לחזור לדני מחר')
    expect((await db('clients').where({ id: o.lead }).first('nextFollowUpAt')).nextFollowUpAt).not.toBeNull()
  })

  it('creates a meeting, after approval', async () => {
    const o = await owner()
    const h = harness([agentSays({ actionType: 'create_meeting', args: { clientId: o.lead, title: 'פגישה עם דני', date: day('מחר'), startTime: '10:00', durationMinutes: 30 } }, o.lead)])
    await approve(o, h, 'תקבע פגישה עם דני מחר ב-10:00')
    expect(await db('meetings').where({ lead_id: o.lead })).toHaveLength(1)
  })

  it('updates a lead status, after approval', async () => {
    const o = await owner()
    const h = harness([agentSays({ actionType: 'update_lead_status', args: { clientId: o.lead, status: 'closed' } }, o.lead)])
    await approve(o, h, 'תסגור את דני')
    expect((await db('clients').where({ id: o.lead }).first('status')).status).toBe('closed')
  })

  it('adds a lead note, after approval', async () => {
    const o = await owner()
    const h = harness([agentSays({ actionType: 'add_lead_note', args: { clientId: o.lead, content: 'רוצה לדבר שבוע הבא' } }, o.lead)])
    await approve(o, h, 'תוסיף הערה לדני')
    expect(await db('lead_notes').where({ leadId: o.lead })).toHaveLength(1)
  })

  it('a reminder request without consent v5 gets the consent prompt; nothing is created', async () => {
    const o = await owner('v4')
    const h = harness()
    await say(o, 'בעוד 5 דקות תזכיר לי להתקשר לאבי')
    await runWaAssistantWorker({}, h.deps)
    expect(h.runAgent).not.toHaveBeenCalled()
    expect(h.last().body).toBe(REMINDER_COPY.consent)
    expect(await db('owner_personal_reminders').where({ agencyId: o.agencyId })).toEqual([])
  })

  it('with consent v5, a reminder gets a card and is scheduled only after approval', async () => {
    const o = await owner('v5')
    const h = harness()
    await say(o, 'בעוד 5 דקות תזכיר לי להתקשר לאבי')
    await runWaAssistantWorker({}, h.deps)
    expect(h.runAgent).not.toHaveBeenCalled()
    expect(h.last().buttons).toHaveLength(2)
    expect((await db('owner_personal_reminders').where({ agencyId: o.agencyId }).first('status')).status).toBe('proposed')
    await tap(o, h.last().buttons![0].id)
    await runWaAssistantWorker({}, h.deps)
    expect((await db('owner_personal_reminders').where({ agencyId: o.agencyId }).first('status')).status).toBe('scheduled')
  })

  it('cannot act on another agency\'s lead', async () => {
    const o = await owner()
    const other = await owner()
    const h = harness([agentSays({ actionType: 'create_task', args: { clientId: other.lead, title: 'x', dueDate: day('מחר') } }, other.lead)])
    await say(o, 'תפתח משימה')
    await runWaAssistantWorker({}, h.deps)
    await db('wa_assistant_jobs').where({ agencyId: o.agencyId }).first()
    expect(await db('tasks').where({ clientId: other.lead })).toEqual([])
    expect(h.last().buttons ?? []).toHaveLength(0)
  })

  it('is counted, and gets no founder exemption', async () => {
    process.env.CREDITS_METERING = '1'
    const o = await owner()
    const h = harness([agentSays(null, o.lead)])
    await say(o, 'מה קורה היום?')
    await runWaAssistantWorker({}, h.deps)
    expect((await db('agent_requests').where({ agencyId: o.agencyId }).first('tier')).tier).toBe('free')
  })

  it('an agent question reaches the Agent with the agency\'s own scope', async () => {
    const o = await owner()
    const h = harness([agentSays(null, o.lead)])
    await say(o, 'כמה לידים יש לי?')
    await runWaAssistantWorker({}, h.deps)
    expect(h.runAgent.mock.calls[0][0].scope).toMatchObject({ agencyId: o.agencyId, userId: o.u })
  })
})
