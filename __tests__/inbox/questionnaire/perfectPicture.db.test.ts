import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { runQuestionnaireWorker } from '@/lib/inbox/autoresponse/questionnaire/worker'
import { markHumanActiveByConversation } from '@/db/conversationHumanPresence'
import { getHandoffSummary } from '@/db/conversationIntelligence'
import type { SendWhatsappTextResult } from '@/lib/whatsapp/sendMessage'

/**
 * Perfect Picture's flow against a real database, with only WhatsApp faked.
 *
 * The harness is worker.db.test.ts's: the webhook's ingest, the job queue, the
 * claim, the state machine, the send guards, the summary, the task note. What
 * this adds is the branching definition (perfect-picture.he.json) end to end,
 * and the rule that a live session finishes on the definition it started with.
 */

const sample = (file: string) =>
  JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples', file), 'utf8'))
const DEF = sample('perfect-picture.he.json')
const OLD_DEF = sample('event-photography.he.json')

type Sent = { to: string; body: string }

let sent: Sent[] = []
let sendImpl: (args: { to: string; body: string }) => Promise<SendWhatsappTextResult>

const send = (async (args: { to: string; body: string }) => {
  const result = await sendImpl(args)
  if (result.ok) sent.push({ to: args.to, body: args.body })
  return result
}) as never

const okSend = async (): Promise<SendWhatsappTextResult> => ({
  ok: true,
  wamid: `wamid.out.${Math.random().toString(36).slice(2)}`,
})

const agencies: number[] = []

type Tenant = {
  agencyId: number
  userId: number
  leadId: number
  conversationId: number
  phoneNumberId: string
  customerWaId: string
}

async function makeTenant(suffix: string, definition: unknown = DEF): Promise<Tenant> {
  // plan 'pro' because the notification engine gates on product access at the
  // delivery boundary; a free agency would prove nothing about the emission.
  const [a] = await db('agencies')
    .insert({ name: `q-pp-${suffix}`, autoResponseEnabled: true, plan: 'pro' })
    .returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [u] = await db('users').insert({ firstName: 'נ', role: 'AGNT', agencyId }).returning('id')
  const userId = Number(u.id)
  const phoneNumberId = `q_pp_pn_${suffix}`
  const customerWaId = `97252${String(agencyId).padStart(7, '0')}`
  await db('whatsapp_connections').insert({
    user_id: userId,
    agency_id: agencyId,
    phone_number_id: phoneNumberId,
    access_token: 'test-token',
  })
  await db('auto_response_settings').insert({
    agencyId,
    channel: 'whatsapp',
    enabled: true,
    mode: 'acknowledge',
    responder: 'questionnaire',
    questionnaire: JSON.stringify(definition),
    updatedBy: userId,
  })
  const [c] = await db('clients')
    .insert({
      firstName: 'פונה',
      lastName: 'חדש',
      phone: customerWaId,
      agencyId,
      userId,
      handlerId: userId,
      createdById: userId,
      status: 'new',
    })
    .returning('id')
  const leadId = Number(c.id)
  const [conv] = await db('inbox_conversations')
    .insert({ agencyId, leadId, channel: 'whatsapp', businessPhoneNumberId: phoneNumberId, customerWaId })
    .returning('id')
  return { agencyId, userId, leadId, conversationId: Number(conv.id), phoneNumberId, customerWaId }
}

/** Exactly what the webhook does with one customer message. */
async function customerSays(t: Tenant, body: string, opts: { type?: string } = {}): Promise<void> {
  const type = opts.type ?? 'text'
  await ingestWhatsappInbound({
    agencyId: t.agencyId,
    leadId: t.leadId,
    businessPhoneNumberId: t.phoneNumberId,
    customerWaId: t.customerWaId,
    customerName: 'פונה חדש',
    rawMessage: {
      id: `wamid.in.${Math.random().toString(36).slice(2)}`,
      from: t.customerWaId,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type,
      ...(type === 'text' ? { text: { body } } : { [type]: { id: 'media-id' } }),
    },
  })
}

async function drain(): Promise<void> {
  await runQuestionnaireWorker({ deps: { send }, workerId: `test-${Math.random()}` })
}

const lastMessage = (): string => sent[sent.length - 1]?.body ?? ''

async function sessionRow(t: Tenant) {
  return db('questionnaire_sessions').where({ conversationId: t.conversationId }).orderBy('id', 'desc').first()
}

beforeAll(() => {
  process.env.WA_QUESTIONNAIRE_ENABLED = '1'
  process.env.WA_QUESTIONNAIRE_AGENCY_IDS = 'all'
  process.env.NOTIFICATIONS_ENABLED = '1'
  process.env.NOTIFICATIONS_AGENCY_ALLOWLIST = 'all'
})

beforeEach(() => {
  sent = []
  sendImpl = okSend
})

afterAll(async () => {
  delete process.env.WA_QUESTIONNAIRE_ENABLED
  delete process.env.WA_QUESTIONNAIRE_AGENCY_IDS
  delete process.env.NOTIFICATIONS_ENABLED
  delete process.env.NOTIFICATIONS_AGENCY_ALLOWLIST
  await db('analytics_events').whereIn('agencyId', agencies).del()
  await db('notification_jobs').whereIn('agencyId', agencies).del()
  await db('questionnaire_sessions').whereIn('agencyId', agencies).del()
  await db('auto_response_jobs').whereIn('agencyId', agencies).del()
  await db('conversation_ai_state').whereIn('agencyId', agencies).del()
  await db('conversation_intelligence').whereIn('agencyId', agencies).del()
  await db('inbox_messages').whereIn('agencyId', agencies).del()
  await db('inbox_participants').whereIn('agencyId', agencies).del()
  await db('inbox_conversations').whereIn('agencyId', agencies).del()
  await db('auto_response_settings').whereIn('agencyId', agencies).del()
  await db('tasks').whereIn('clientId', db('clients').select('id').whereIn('agencyId', agencies)).del()
  await db('clients').whereIn('agencyId', agencies).del()
  await db('whatsapp_connections').whereIn('agency_id', agencies).del()
  await db('users').whereIn('agencyId', agencies).del()
  await db('agencies').whereIn('id', agencies).del()
})


const SITE = 'https://picture-perfect.co.il'

/** One customer message, one worker pass; returns what we sent back. */
async function turn(t: Tenant, body: string): Promise<string[]> {
  const before = sent.length
  await customerSays(t, body)
  await drain()
  await drain() // a second pass must find nothing to do
  return sent.slice(before).map((m) => m.body)
}

async function noModelWork(t: Tenant): Promise<void> {
  const analysis = await db('conversation_analysis_jobs').where({ conversationId: t.conversationId }).first('id')
  expect(analysis, 'a questionnaire conversation must not buy a model call').toBeFalsy()
  const agentJobs = await db('auto_response_jobs')
    .where({ conversationId: t.conversationId })
    .whereNot({ reason: 'questionnaire_turn' })
    .first('id')
  expect(agentJobs, 'every job is a questionnaire turn').toBeFalsy()
}

describe('bar mitzvah, end to end', () => {
  it('one message per turn, congratulations once, website at the end, everything kept for the rep', async () => {
    const t = await makeTenant('bar')
    expect(await turn(t, 'היי')).toHaveLength(1)

    const afterType = await turn(t, 'אני מתכנן בר מצווה לבן שלי')
    expect(afterType).toEqual([expect.stringContaining('קודם כל המון מזל טוב 🎉')])

    expect(await turn(t, '18.11.2026')).toEqual([expect.stringContaining('איפה האירוע יתקיים?')])
    expect(await turn(t, 'רחובות')).toEqual([expect.stringContaining('איזה שירות צילום אתם מחפשים?')])

    const closing = await turn(t, 'הכל')
    expect(closing).toHaveLength(1)
    expect(closing[0]).toContain('בדיקת זמינות והתאמת הצעה לאירוע')
    expect(closing[0]).toContain(SITE)
    expect(sent.filter((m) => m.body.includes('מזל טוב'))).toHaveLength(1)

    const session = await sessionRow(t)
    expect(session?.status).toBe('completed')
    expect(session?.definitionRevision).toBe(DEF.revision)
    expect(session?.answers).toEqual({
      event_type: ['bar_bat_mitzvah'],
      'event_type:raw': ['אני מתכנן בר מצווה לבן שלי'],
      event_date_celebration: ['18.11.2026'],
      event_location: ['רחובות'],
      service: ['all'],
    })

    const summary = await getHandoffSummary(t.agencyId, t.conversationId)
    expect(summary?.complete).toBe(true)
    expect(summary?.fields).toEqual([
      { label: 'סוג האירוע / השירות', value: 'בר / בת מצווה (אני מתכנן בר מצווה לבן שלי)' },
      { label: 'תאריך האירוע', value: '18.11.2026' },
      { label: 'מיקום האירוע', value: 'רחובות' },
      { label: 'שירות צילום', value: 'הכל' },
    ])
    const task = await db('tasks').where({ clientId: t.leadId }).orderBy('id', 'desc').first('notes')
    expect(JSON.stringify(task?.notes)).toContain('אני מתכנן בר מצווה לבן שלי')

    const outbound = await db('inbox_messages').where({ conversationId: t.conversationId, direction: 'outbound' })
    expect(outbound).toHaveLength(5)
    await noModelWork(t)
  })
})

describe('drone / real estate, end to end', () => {
  it('takes the drone branch and closes with the drone text and the website', async () => {
    const t = await makeTenant('drone')
    await turn(t, 'היי')
    expect(await turn(t, 'צריך רחפן לצילום נכס')).toEqual(['באיזו עיר תרצו לבצע את הצילום / ההטסה?'])
    expect(await turn(t, 'חולון')).toEqual([expect.stringContaining('האם יש לכם אישור הטסה באזור?')])
    expect(await turn(t, 'כן')).toEqual(['לאיזה תאריך תרצו לתאם את הצילום? 📅\nאפשר לכתוב תאריך מדויק או משוער. אם עדיין לא נקבע תאריך, כתבו: לא נקבע'])
    const closing = await turn(t, '20.10.2026')
    expect(closing[0]).toContain('להמשך בדיקה ותיאום הצילום')
    expect(closing[0]).toContain(SITE)

    const summary = await getHandoffSummary(t.agencyId, t.conversationId)
    expect(summary?.fields).toEqual([
      { label: 'סוג האירוע / השירות', value: 'צילום רחפן / נדל״ן (צריך רחפן לצילום נכס)' },
      { label: 'עיר', value: 'חולון' },
      { label: 'אישור הטסה', value: 'כן' },
      { label: 'תאריך הצילום', value: '20.10.2026' },
    ])
    const state = await db('conversation_ai_state').where({ conversationId: t.conversationId }).first('aiState')
    expect(state?.aiState).toBe('escalated')
    await noModelWork(t)
  })
})

describe('a person at any stage', () => {
  it('"נציג" mid-flow hands off with what was collected', async () => {
    const t = await makeTenant('rep')
    await turn(t, 'היי')
    await turn(t, 'חתונה')
    expect(await turn(t, 'נציג')).toEqual([DEF.handoff])
    const session = await sessionRow(t)
    expect(session).toMatchObject({ status: 'handed_off', endedReason: 'human_request' })
    expect(session?.answers).toEqual({ event_type: ['wedding'] })
  })

  it('a rep taking over silences it', async () => {
    const t = await makeTenant('takeover')
    await turn(t, 'היי')
    await markHumanActiveByConversation(t.conversationId, t.agencyId)
    expect(await turn(t, 'בר מצווה')).toEqual([])
    expect((await sessionRow(t))?.status).toBe('human_took_over')
  })
})

describe('a definition changed mid-conversation', () => {
  it('the live session finishes on the menu the customer was shown; new conversations get the new one', async () => {
    const t = await makeTenant('pinned', OLD_DEF)
    const opening = await turn(t, 'היי')
    expect(opening[0]).toContain('1. צילום סטילס')

    // The business switches to the new definition while this customer is mid-answer.
    await db('auto_response_settings')
      .where({ agencyId: t.agencyId, channel: 'whatsapp' })
      .update({ questionnaire: JSON.stringify(DEF) })

    // "1,2" means stills + video on the menu they saw; it must not be read
    // against the new entry question.
    expect(await turn(t, '1,2')).toEqual([expect.stringContaining('מה סוג האירוע?')])
    const session = await sessionRow(t)
    expect(session?.answers).toEqual({ services: ['stills', 'video'] })
    expect(session?.definitionRevision).toBe(OLD_DEF.revision)

    const fresh = await makeTenant('pinned-new')
    expect((await turn(fresh, 'היי'))[0]).toContain('איזה אירוע או שירות צילום אתם מחפשים?')
  })
})

describe('a non-answer to the date question (production reproducer)', () => {
  it('"לתאריך" is re-asked once, does not advance, and "לא נקבע" then moves on as not_set', async () => {
    const t = await makeTenant('date-check')
    await turn(t, 'היי')
    await turn(t, 'חתונה')

    const reask = await turn(t, 'לתאריך') // turn() drains twice: a retry must add nothing
    expect(reask).toEqual([
      'לא הצלחתי לזהות תאריך 📅\nאפשר לכתוב תאריך מדויק או משוער. אם עדיין לא נקבע תאריך, כתבו: לא נקבע',
    ])
    let session = await sessionRow(t)
    expect(session).toMatchObject({ status: 'active', currentStepId: 'event_date_celebration', invalidCount: 1 })
    expect(session?.answers).toEqual({ event_type: ['wedding'] })

    expect(await turn(t, 'לא נקבע')).toEqual(['איפה האירוע יתקיים? אפשר לכתוב עיר או שם של אולם'])
    session = await sessionRow(t)
    expect(session).toMatchObject({ currentStepId: 'event_location', invalidCount: 0 })
    expect(session?.answers).toMatchObject({ event_date_celebration: ['לא נקבע'], 'event_date_celebration:state': ['not_set'] })

    const summary = await getHandoffSummary(t.agencyId, t.conversationId)
    expect(summary?.fields).toContainEqual({ label: 'תאריך האירוע', value: 'טרם נקבע' })
    await noModelWork(t)
  })
})
