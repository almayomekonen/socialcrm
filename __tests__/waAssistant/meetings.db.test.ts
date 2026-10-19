import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * WhatsApp meeting creation against a real PostgreSQL and the REAL Action
 * Runtime (submitProposedAction / decideOnAction / create_meeting). Only the
 * model, Meta and Google are mocked; nothing leaves the test database.
 *
 * NOTE: over the 250-line soft limit on purpose: one flat list of independent
 * scenarios over a shared harness (owners, leads, cards, taps); splitting it
 * would duplicate that harness across files for no readability gain.
 */
const flags = vi.hoisted(() => ({ agent: true }))
vi.mock('@/lib/ai/flags', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/flags')>()), isAgentEnabled: () => flags.agent }))
vi.mock('@/lib/agent/trace', () => ({ agentTrace: vi.fn() }))

import { db } from '@/config/db'
import { processPlatformMessage } from '@/lib/whatsapp/platform/inbound'
import { runWaAssistantWorker } from '@/lib/waAssistant/worker'
import { updateMeetingSyncState } from '@/db/meetings'
import { businessInstantMs } from '@/lib/today/time'
import { parseHebrewWhen } from '@/lib/waAssistant/meetings/when'
import { MEETING_COPY } from '@/lib/waAssistant/meetings/copy'
import { COPY, NO_ACTIONS_NOTE } from '@/lib/waAssistant/render'
import { CALENDAR_EVENTS_SCOPE } from '@/lib/integrations/google/calendarTokens'
import { PLATFORM, TOKEN, agency, cleanup, recipient, resetBetweenTests, user } from '../ownerWhatsappReminders/reminderFixtures'

const A = 103
let B: number
let seq = 0
const MIN = 60_000
const TOMORROW = () => parseHebrewWhen('מחר', Date.now()).date!
const DAY_AFTER = () => parseHebrewWhen('מחרתיים', Date.now()).date!

type Owner = { u: number; r: number; digits: string; lead: number }

async function owner(role = 'ADMIN', agencyId = A): Promise<Owner> {
  const u = await user(agencyId, role)
  const digits = `9725000071${String(++seq).padStart(2, '0')}`
  const r = await recipient(agencyId, u, digits)
  const [c] = await db('clients').insert({ firstName: 'Itamar', lastName: 'Am', agencyId, userId: u, createdById: u, lead: true }).returning('id')
  return { u, r, digits, lead: Number(c.id) }
}

const meetingAnswer = (clientId: number, over: Record<string, unknown> = {}) => ({
  ok: true as const,
  answer: {
    headline: 'קבעתי לך פגישה',
    claims: [{ claimClass: 'FACT', text: 'Itamar Am נמצא', entityEvidence: [`lead:${clientId}`] }],
    unknown: null,
    proposedAction: { actionType: 'create_meeting', args: { clientId, title: 'פגישה עם Itamar Am', date: TOMORROW(), startTime: '10:00', durationMinutes: 45, note: null, ...over }, evidenceRefs: [`lead:${clientId}`] },
  },
  evidence: [],
  steps: 2,
  stopReason: 'answered' as const,
  investigationId: `inv_wa_mt_${++seq}`,
  costUsd: 0.01,
})

function harness(agentResults: unknown[] = []) {
  const runAgent = vi.fn(async () => (agentResults.shift() ?? meetingAnswer(0)) as never)
  const sendText = vi.fn(async (_i: Record<string, any>) => ({ kind: 'sent' as const, wamid: `wamid.R_${++seq}` }))
  const pushGoogle = vi.fn(async (i: { meetingId: number }): Promise<{ meetUrl: string | null; syncStatus: 'synced' | 'failed' | 'reauth_required' }> => {
    await updateMeetingSyncState(i.meetingId, { status: 'synced', googleEventId: `g_${i.meetingId}`, googleIcalUid: 'ical', meetUrl: null, etag: 'e' })
    return { meetUrl: null, syncStatus: 'synced' as const }
  })
  const deps = { runAgent: runAgent as never, sendText: sendText as never, typing: (async () => undefined) as never, meetings: { decide: { pushGoogle: pushGoogle as never } } }
  const last = () => sendText.mock.calls.at(-1)![0] as { body: string; buttons?: { id: string; title: string }[]; toE164: string }
  return { runAgent, sendText, pushGoogle, deps, last }
}

async function say(o: Owner, body: string) {
  const id = `wamid.__wa_mt_${++seq}`
  expect(await processPlatformMessage({ id, from: o.digits, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } })).toBe('assistant_queued')
}
async function tap(o: Owner, buttonId: string) {
  const id = `wamid.__wa_mt_${++seq}`
  return processPlatformMessage({ id, from: o.digits, timestamp: String(Math.floor(Date.now() / 1000)), type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'x' } } })
}
const run = (h: ReturnType<typeof harness>, now?: () => Date) => runWaAssistantWorker({}, { ...h.deps, ...(now ? { now } : {}) })
const meetings = (lead: number) => db('meetings').where({ lead_id: lead })
const actions = (agencyId = A) => db('agent_actions').where({ agencyId })

/** Ask for a meeting and return the card's two button ids. */
async function card(o: Owner, h: ReturnType<typeof harness>, text = 'תקבע לי עם Itamar Am מחר ב-10:00') {
  await say(o, text)
  await run(h)
  const sent = h.last()
  expect(sent.buttons?.map((b) => b.title)).toEqual(['לאשר ולקבוע', 'ביטול'])
  return { approve: sent.buttons![0].id, reject: sent.buttons![1].id, body: sent.body }
}

beforeAll(async () => {
  await agency('__wa_mt_103__', A)
  B = await agency('__wa_mt_b__')
})
beforeEach(async () => {
  await resetBetweenTests()
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  await db('meetings').whereIn('agency_id', [A, B]).del()
  await db('google_calendar_connections').whereIn('agency_id', [A, B]).del()
  await db('agencies').where({ id: A }).update({ plan: 'pro', planReason: null, trialExempt: false, trialStartedAt: null, trialEndsAt: null })
  flags.agent = true
  process.env.WA_ASSISTANT_AGENCY_IDS = String(A)
  process.env.WA_ASSISTANT_MEETINGS_AGENCY_IDS = String(A)
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = String(A)
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
  process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
})
afterAll(async () => {
  for (const k of ['WA_ASSISTANT_AGENCY_IDS', 'WA_ASSISTANT_MEETINGS_AGENCY_IDS', 'OWNER_WA_REMINDERS_AGENCY_IDS', 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'PLATFORM_WHATSAPP_ACCESS_TOKEN']) delete process.env[k]
  for (const t of ['wa_assistant_jobs', 'wa_assistant_approvals', 'agent_action_approvals', 'agent_actions']) await db(t).del()
  await db('meetings').whereIn('agency_id', [A, B]).del()
  await db('google_calendar_connections').whereIn('agency_id', [A, B]).del()
  await db('analytics_events').whereIn('agencyId', [A, B]).del()
  await cleanup()
})

describe('"תקבע לי עם Itamar Am מחר ב-10:00": card first, nothing created', () => {
  it('a confirmation card with the real lead, date and time; an action AWAITING approval; no meeting', async () => {
    const o = await owner()
    const h = harness([meetingAnswer(o.lead)])
    const c = await card(o, h)
    expect(c.body).toContain('Itamar Am')
    expect(c.body).toContain('10:00–10:45')
    expect(c.body).toContain('SocialCRM בלבד')
    expect(c.body).not.toContain('קבעתי') // the model's prose never reaches the owner
    expect(await meetings(o.lead)).toHaveLength(0)
    const [act] = await actions()
    expect(act).toMatchObject({ actionType: 'create_meeting', executionState: 'NOT_EXECUTED', approvalState: 'PENDING' })
  })

  it('approve: the meeting is created through the runtime, at 10:00 business time, and the reply is read back from the row', async () => {
    const o = await owner()
    const h = harness([meetingAnswer(o.lead)])
    const c = await card(o, h)
    expect(await tap(o, c.approve)).toBe('assistant_queued')
    await run(h)
    const [m] = await meetings(o.lead)
    expect(m).toMatchObject({ agency_id: A, organizer_user_id: o.u, status: 'scheduled', sync_status: 'pending' })
    expect(new Date(m.start_at).getTime()).toBe(businessInstantMs(TOMORROW(), '10:00'))
    expect(new Date(m.end_at).getTime() - new Date(m.start_at).getTime()).toBe(45 * MIN)
    expect(h.last().body).toContain('הפגישה נקבעה ב-SocialCRM')
    expect(h.last().body).toContain('יומן Google לא מחובר')
    expect(h.pushGoogle).not.toHaveBeenCalled()
    expect((await actions().first()).executionState).toBe('SUCCEEDED')
  })

  it('with Google connected: pushed ONCE, without attendees, and the reply reports the synced row', async () => {
    const o = await owner()
    await db('google_calendar_connections').insert({ user_id: o.u, agency_id: A, google_sub: `s${o.u}`, google_email: 'o@t.test', access_token: 'x', refresh_token: 'y', expires_at: new Date(Date.now() + 3600_000), scope: CALENDAR_EVENTS_SCOPE, primary_calendar_id: 'primary', sync_status: 'active' })
    const h = harness([meetingAnswer(o.lead)])
    const c = await card(o, h)
    expect(c.body).toContain('יומן Google שלך')
    await tap(o, c.approve)
    await run(h)
    expect(h.pushGoogle).toHaveBeenCalledTimes(1)
    expect(h.pushGoogle.mock.calls[0][0]).toMatchObject({ attendees: [], userId: o.u })
    expect(h.last().body).toContain('נוספה גם ליומן Google')
  })

  it('a Google failure is reported as such; the CRM meeting stands', async () => {
    const o = await owner()
    await db('google_calendar_connections').insert({ user_id: o.u, agency_id: A, google_sub: `s${o.u}`, google_email: 'o@t.test', access_token: 'x', refresh_token: 'y', expires_at: new Date(Date.now() + 3600_000), scope: CALENDAR_EVENTS_SCOPE, primary_calendar_id: 'primary', sync_status: 'active' })
    const h = harness([meetingAnswer(o.lead)])
    h.pushGoogle.mockImplementationOnce(async (i: { meetingId: number }) => {
      await updateMeetingSyncState(i.meetingId, { status: 'failed', syncError: 'push:500' } as never)
      return { meetUrl: null, syncStatus: 'failed' as const }
    })
    const c = await card(o, h)
    await tap(o, c.approve)
    await run(h)
    expect(await meetings(o.lead)).toHaveLength(1)
    expect(h.last().body).toContain('לא הצלחתי להוסיף אותה ליומן Google')
  })
})

describe('the approval is single-use, bound and expiring', () => {
  it('a replayed approve creates nothing more', async () => {
    const o = await owner()
    const h = harness([meetingAnswer(o.lead)])
    const c = await card(o, h)
    await tap(o, c.approve)
    await run(h)
    await tap(o, c.approve)
    await run(h)
    expect(await meetings(o.lead)).toHaveLength(1)
    expect(h.last().body).toBe(MEETING_COPY.alreadyDecided)
  })

  it('cancel: nothing is created, and a later approve cannot revive it', async () => {
    const o = await owner()
    const h = harness([meetingAnswer(o.lead)])
    const c = await card(o, h)
    await tap(o, c.reject)
    await run(h)
    expect(h.last().body).toBe(MEETING_COPY.rejected)
    await tap(o, c.approve)
    await run(h)
    expect(await meetings(o.lead)).toHaveLength(0)
    expect((await actions().first()).approvalState).toBe('REJECTED')
  })

  it('after 15 minutes the card has expired', async () => {
    const o = await owner()
    const h = harness([meetingAnswer(o.lead)])
    const c = await card(o, h)
    await tap(o, c.approve)
    await run(h, () => new Date(Date.now() + 16 * MIN))
    expect(h.last().body).toBe(MEETING_COPY.expired)
    expect(await meetings(o.lead)).toHaveLength(0)
  })

  it('a newer card supersedes the older one', async () => {
    const o = await owner()
    const h = harness([meetingAnswer(o.lead), meetingAnswer(o.lead, { startTime: '12:00' })])
    const first = await card(o, h)
    await card(o, h, 'תקבע לי עם Itamar Am מחר ב-12:00')
    await tap(o, first.approve)
    await run(h)
    expect(h.last().body).toBe(MEETING_COPY.superseded)
    expect(await meetings(o.lead)).toHaveLength(0)
  })

  it("another owner's phone cannot use the button", async () => {
    const o = await owner()
    const other = await owner()
    const h = harness([meetingAnswer(o.lead)])
    const c = await card(o, h)
    await tap(other, c.approve)
    await run(h)
    expect(h.last().toE164).toBe(`+${other.digits}`)
    expect(h.last().body).toBe(MEETING_COPY.notFound)
    expect(await meetings(o.lead)).toHaveLength(0)
  })

  it('tampered arguments: the stored action no longer matches the card, nothing runs', async () => {
    const o = await owner()
    const h = harness([meetingAnswer(o.lead)])
    const c = await card(o, h)
    await db('agent_actions').where({ agencyId: A }).update({ argsHash: 'tampered' })
    await tap(o, c.approve)
    await run(h)
    expect(h.last().body).toBe(MEETING_COPY.changed)
    expect(await meetings(o.lead)).toHaveLength(0)
  })

  it('a typed "כן" never approves; it points at the button', async () => {
    const o = await owner()
    const h = harness([meetingAnswer(o.lead)])
    await card(o, h)
    await say(o, 'כן')
    await run(h)
    expect(h.last().body).toBe(MEETING_COPY.useButtons)
    expect(h.runAgent).toHaveBeenCalledTimes(1)
    expect(await meetings(o.lead)).toHaveLength(0)
  })
})

describe('never guessed: date, time, lead, availability', () => {
  it('the model\'s date differs from the owner\'s words: ask, record nothing', async () => {
    const o = await owner()
    const h = harness([meetingAnswer(o.lead, { date: DAY_AFTER() })])
    await say(o, 'תקבע לי עם Itamar Am מחר ב-10:00')
    await run(h)
    expect(h.last().body).toBe(MEETING_COPY.mismatch)
    expect(h.last().buttons).toBeUndefined()
    expect(await actions()).toHaveLength(0)
  })

  it('no time given: ask; the answer completes the same request', async () => {
    const o = await owner()
    const h = harness([meetingAnswer(o.lead), meetingAnswer(o.lead, { startTime: '11:00' })])
    await say(o, 'תקבע לי עם Itamar Am מחר')
    await run(h)
    expect(h.last().body).toBe(MEETING_COPY.askTime)
    await say(o, 'ב-11')
    await run(h)
    expect(h.last().buttons).toHaveLength(2)
    expect(h.last().body).toContain('11:00–11:45')
  })

  it('an hour that could be morning or evening: ask', async () => {
    const o = await owner()
    const h = harness([meetingAnswer(o.lead, { startTime: '05:00' })])
    await say(o, 'תקבע לי עם Itamar Am מחר ב-5')
    await run(h)
    expect(h.last().body).toBe(MEETING_COPY.ambiguousTime)
    expect(await actions()).toHaveLength(0)
  })

  it('a SocialCRM conflict: no card, free slots offered, attributed to SocialCRM', async () => {
    const o = await owner()
    await db('meetings').insert({ agency_id: A, organizer_user_id: o.u, lead_id: o.lead, title: 'קיימת', timezone: 'Asia/Jerusalem', start_at: new Date(businessInstantMs(TOMORROW(), '10:00')), end_at: new Date(businessInstantMs(TOMORROW(), '11:00')), status: 'scheduled', sync_status: 'pending' })
    const h = harness([meetingAnswer(o.lead)])
    await say(o, 'תקבע לי עם Itamar Am מחר ב-10:00')
    await run(h)
    expect(h.last().body).toContain('כבר יש לך פגישה ב-SocialCRM (10:00–11:00)')
    expect(h.last().body).toContain('11:00, 11:30')
    expect(await actions()).toHaveLength(0)
  })

  it('a conflict that appears after the card: approve creates nothing', async () => {
    const o = await owner()
    const h = harness([meetingAnswer(o.lead)])
    const c = await card(o, h)
    await db('meetings').insert({ agency_id: A, organizer_user_id: o.u, lead_id: o.lead, title: 'חדשה', timezone: 'Asia/Jerusalem', start_at: new Date(businessInstantMs(TOMORROW(), '10:30')), end_at: new Date(businessInstantMs(TOMORROW(), '11:00')), status: 'scheduled', sync_status: 'pending' })
    await tap(o, c.approve)
    await run(h)
    expect(h.last().body).toContain('כבר יש לך פגישה ב-SocialCRM')
    expect(await meetings(o.lead)).toHaveLength(1) // only the conflicting one
    expect((await actions().first()).approvalState).toBe('REJECTED')
  })
})

describe('tenant isolation and authorization', () => {
  it("another agency's lead: refused before any action exists", async () => {
    const o = await owner()
    const foreign = await owner('ADMIN', B)
    const h = harness([meetingAnswer(foreign.lead)])
    await say(o, 'תקבע לי עם Itamar Am מחר ב-10:00')
    await run(h)
    expect(h.last().body).toBe(MEETING_COPY.leadNotAllowed)
    expect(await db('agent_actions')).toHaveLength(0)
  })

  it("a rep cannot book a colleague's lead", async () => {
    const admin = await owner()
    const rep = await owner('AGNT')
    const h = harness([meetingAnswer(admin.lead)])
    await say(rep, 'תקבע לי עם Itamar Am מחר ב-10:00')
    await run(h)
    expect(h.last().body).toBe(MEETING_COPY.leadNotAllowed)
    expect(await meetings(admin.lead)).toHaveLength(0)
  })

  it('the Agent rollout is re-checked when the button is tapped', async () => {
    const o = await owner()
    const h = harness([meetingAnswer(o.lead)])
    const c = await card(o, h)
    flags.agent = false
    await tap(o, c.approve)
    await run(h)
    expect(h.last().body).toBe(COPY.notAvailable)
    expect(await meetings(o.lead)).toHaveLength(0)
  })
})

describe('the meetings flag: absent means read-only, exactly as before', () => {
  it('a proposal gets the no-actions note and records nothing; a button does nothing', async () => {
    delete process.env.WA_ASSISTANT_MEETINGS_AGENCY_IDS
    const o = await owner()
    const h = harness([meetingAnswer(o.lead)])
    await say(o, 'תקבע לי עם Itamar Am מחר ב-10:00')
    await run(h)
    expect(h.last().body).toContain(NO_ACTIONS_NOTE)
    expect(h.last().buttons).toBeUndefined()
    expect(await actions()).toHaveLength(0)
    expect(await tap(o, `wa:approve:${'a'.repeat(32)}`)).toBe('assistant_queued')
    await run(h)
    expect(h.last().body).toBe(COPY.notAvailable)
    expect(await meetings(o.lead)).toHaveLength(0)
  })
})

describe('webhook', () => {
  it('only our own button ids are queued; other interactive payloads are ignored', async () => {
    const o = await owner()
    expect(await tap(o, 'wa:approve:nothex')).toBe('ignored')
    expect(await tap(o, 'questionnaire:q1:o2')).toBe('ignored')
    expect(await tap(o, `wa:reject:${'0'.repeat(32)}`)).toBe('assistant_queued')
    expect((await db('wa_assistant_jobs').first('kind')).kind).toBe('decision')
  })

  it('opt-out still wins over everything', async () => {
    const o = await owner()
    expect(await processPlatformMessage({ id: `wamid.__wa_mt_${++seq}`, from: o.digits, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'הסר' } })).toBe('opted_out')
    expect(await db('wa_assistant_jobs')).toHaveLength(0)
  })
})
