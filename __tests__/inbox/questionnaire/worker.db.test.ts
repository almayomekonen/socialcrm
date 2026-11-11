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
 * The whole feature, against a real database, with only WhatsApp itself faked.
 *
 * Everything else is the production path: the webhook's ingest, the job queue,
 * the claim, the state machine, the send guards, the summary, the task note.
 * What is injected is the Graph call, because the one thing this suite must
 * never do is send a real message.
 */

const DEF = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/event-photography.he.json'), 'utf8'),
)

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

async function makeTenant(suffix: string, responder: 'agent' | 'questionnaire' = 'questionnaire'): Promise<Tenant> {
  // plan 'pro' because the notification engine gates on product access at the
  // delivery boundary; a free agency would prove nothing about the emission.
  const [a] = await db('agencies')
    .insert({ name: `q-worker-${suffix}`, autoResponseEnabled: true, plan: 'pro' })
    .returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [u] = await db('users').insert({ firstName: 'נ', role: 'AGNT', agencyId }).returning('id')
  const userId = Number(u.id)
  const phoneNumberId = `q_worker_pn_${suffix}`
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
    responder,
    questionnaire: JSON.stringify(DEF),
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

describe('a complete conversation', () => {
  it('walks the customer through the questions and hands the answers to a rep', async () => {
    const t = await makeTenant('full')

    await customerSays(t, 'היי, אשמח לפרטים')
    await drain()
    expect(lastMessage()).toContain('תודה שפניתם אלינו')
    expect(lastMessage()).toContain('1. צילום סטילס')

    await customerSays(t, '1,2')
    await drain()
    expect(lastMessage()).toContain('מה סוג האירוע?')

    await customerSays(t, '1')
    await drain()
    expect(lastMessage()).toContain('איזה כיסוי')

    await customerSays(t, '1')
    await drain()
    expect(lastMessage()).toContain('תאריך האירוע')

    await customerSays(t, '14 ביוני 2027')
    await drain()
    expect(lastMessage()).toContain('כמה אורחים')

    await customerSays(t, 'בערך 300')
    await drain()
    expect(lastMessage()).toContain('עיר או אזור')

    await customerSays(t, 'חיפה')
    await drain()
    expect(lastMessage()).toContain('קיבלנו את הפרטים')

    const session = await sessionRow(t)
    expect(session?.status).toBe('completed')
    expect(session?.answers).toMatchObject({
      services: ['stills', 'video'],
      event_type: ['wedding'],
      wedding_coverage: ['full'],
      event_date: ['14 ביוני 2027'],
      guests: ['בערך 300'],
      area: ['חיפה'],
    })

    // What the rep sees: the banner rows and the note on the lead's task.
    const summary = await getHandoffSummary(t.agencyId, t.conversationId)
    expect(summary?.source).toBe('questionnaire')
    expect(summary?.complete).toBe(true)
    expect(summary?.fields).toEqual([
      { label: 'שירותים', value: 'צילום סטילס, וידאו' },
      { label: 'סוג האירוע', value: 'חתונה' },
      { label: 'היקף הכיסוי', value: 'חבילת חתונה מלאה' },
      { label: 'תאריך האירוע', value: '14 ביוני 2027' },
      { label: 'מספר אורחים', value: 'בערך 300' },
      { label: 'אזור', value: 'חיפה' },
    ])

    const task = await db('tasks').where({ clientId: t.leadId }).orderBy('id', 'desc').first('notes')
    expect(JSON.stringify(task?.notes)).toContain('חבילת חתונה מלאה')

    const state = await db('conversation_ai_state').where({ conversationId: t.conversationId }).first('aiState')
    expect(state?.aiState).toBe('escalated')

    const notification = await db('notification_jobs')
      .where({ agencyId: t.agencyId, type: 'lead.questionnaire_handoff' })
      .first('id')
    expect(notification, 'the rep is told through the existing notification engine').toBeTruthy()

    // The guarantee: no Copilot analysis job was ever created for this thread.
    const analysis = await db('conversation_analysis_jobs').where({ conversationId: t.conversationId }).first('id')
    expect(analysis, 'a questionnaire conversation must not buy a model call').toBeFalsy()
  })
})

describe('messages that arrive together', () => {
  it('asks one question, not two, and answers the newest selection', async () => {
    const t = await makeTenant('batch')
    await customerSays(t, 'שלום')
    await drain()
    sent = []

    // Two messages before the worker runs: a pick and an immediate correction.
    await customerSays(t, '1')
    await customerSays(t, '2')
    await drain()

    expect(sent).toHaveLength(1)
    const session = await sessionRow(t)
    expect(session?.answers).toMatchObject({ services: ['video'] })
  })

  it('never answers the same customer message twice, however often the worker runs', async () => {
    const t = await makeTenant('idem')
    await customerSays(t, 'שלום')
    await drain()
    await drain()
    await drain()
    expect(sent).toHaveLength(1)
  })
})

describe('when a person steps in', () => {
  it('stops for good once a rep has taken over, and keeps the partial answers', async () => {
    const t = await makeTenant('takeover')
    await customerSays(t, 'שלום')
    await drain()
    await customerSays(t, '1')
    await drain()
    sent = []

    await markHumanActiveByConversation(t.conversationId, t.agencyId)

    await customerSays(t, '1')
    await drain()

    expect(sent, 'the questionnaire must not speak over a rep').toHaveLength(0)
    const session = await sessionRow(t)
    expect(session?.status).toBe('human_took_over')
    expect(session?.answers).toMatchObject({ services: ['stills'] })
    const summary = await getHandoffSummary(t.agencyId, t.conversationId)
    expect(summary?.fields.length).toBeGreaterThan(0)
  })

  it('hands over with the answers when the customer asks for a person', async () => {
    const t = await makeTenant('human')
    await customerSays(t, 'שלום')
    await drain()
    await customerSays(t, '1')
    await drain()
    sent = []

    await customerSays(t, 'אפשר לדבר עם נציג?')
    await drain()

    expect(lastMessage()).toContain('נציג')
    const session = await sessionRow(t)
    expect(session?.status).toBe('handed_off')
    expect(session?.endedReason).toBe('human_request')
    const summary = await getHandoffSummary(t.agencyId, t.conversationId)
    expect(summary?.complete).toBe(false)
    expect(summary?.fields).toEqual([{ label: 'שירותים', value: 'צילום סטילס' }])
  })
})

describe('stopping', () => {
  it('sends nothing more after an opt out, and says nothing when it stops', async () => {
    const t = await makeTenant('optout')
    await customerSays(t, 'שלום')
    await drain()
    sent = []

    await customerSays(t, 'תפסיקו לשלוח לי הודעות')
    await drain()
    expect(sent).toHaveLength(0)

    await customerSays(t, '1')
    await drain()
    expect(sent, 'an opt out is permanent').toHaveLength(0)

    const session = await sessionRow(t)
    expect(session?.status).toBe('opted_out')
    const state = await db('conversation_ai_state').where({ conversationId: t.conversationId }).first('aiState')
    expect(state?.aiState).toBe('opted_out')
  })

  it('stops sending the moment the business switches the automation off', async () => {
    const t = await makeTenant('masteroff')
    await customerSays(t, 'שלום')
    await drain()
    sent = []

    await db('agencies').where({ id: t.agencyId }).update({ autoResponseEnabled: false })
    await customerSays(t, '1')
    await drain()

    // No job is even created while the master switch is off.
    expect(sent).toHaveLength(0)
    await db('agencies').where({ id: t.agencyId }).update({ autoResponseEnabled: true })
  })

  it('hands a live session to a rep when the questionnaire is disabled mid-conversation', async () => {
    const t = await makeTenant('disabled')
    await customerSays(t, 'שלום')
    await drain()
    await customerSays(t, '1')
    await drain()
    sent = []

    await db('auto_response_settings').where({ agencyId: t.agencyId, channel: 'whatsapp' }).update({ responder: 'agent' })
    await customerSays(t, '1')
    await drain()

    const session = await sessionRow(t)
    expect(session?.status).toBe('handed_off')
    expect(session?.endedReason).toBe('engine_disabled')
    // The customer is told, once, that a person will take over (the definition's handoff copy).
    expect(sent).toHaveLength(1)
    expect(sent[0].body.length).toBeGreaterThan(0)
    const summary = await getHandoffSummary(t.agencyId, t.conversationId)
    expect(summary?.fields).toEqual([{ label: 'שירותים', value: 'צילום סטילס' }])
  })
})

describe('when WhatsApp does not answer', () => {
  it('does not resend a question whose outcome is unknown, and asks for a person instead', async () => {
    const t = await makeTenant('ambiguous')
    await customerSays(t, 'שלום')
    await drain()
    sent = []

    sendImpl = async () => ({ ok: false, error: 'send-timeout', ambiguous: true })
    await customerSays(t, '1')
    await drain()

    // Nothing was recorded as delivered, and nothing is tried again.
    expect(sent).toHaveLength(0)
    const session = await sessionRow(t)
    expect(session?.status).toBe('needs_review')
    expect(session?.endedReason).toBe('send_outcome_unknown')

    sendImpl = okSend
    await drain()
    expect(sent, 'an uncertain send is never retried automatically').toHaveLength(0)

    const summary = await getHandoffSummary(t.agencyId, t.conversationId)
    expect(summary?.complete).toBe(false)
    const state = await db('conversation_ai_state').where({ conversationId: t.conversationId }).first('aiState')
    expect(state?.aiState).toBe('escalated')
  })

  it('still saves the answers when the closing message cannot be delivered', async () => {
    const t = await makeTenant('closingfail')
    await customerSays(t, 'שלום')
    await drain()
    for (const answer of ['1', '3', '10 במאי', '50']) {
      await customerSays(t, answer)
      await drain()
    }
    sent = []

    // The last answer completes the questionnaire; the closing send fails hard.
    sendImpl = async () => ({ ok: false, error: 'Graph rejected', code: '131026' })
    await customerSays(t, 'רעננה')
    await drain()

    const session = await sessionRow(t)
    expect(session?.status, 'the session completes even though the goodbye failed').toBe('completed')
    const summary = await getHandoffSummary(t.agencyId, t.conversationId)
    expect(summary?.complete).toBe(true)
    expect(summary?.fields.map((f) => f.label)).toContain('אזור')
    const task = await db('tasks').where({ clientId: t.leadId }).orderBy('id', 'desc').first('notes')
    expect(JSON.stringify(task?.notes)).toContain('רעננה')
  })
})

describe('input it cannot read', () => {
  it('asks for text when a photo arrives, then continues normally', async () => {
    const t = await makeTenant('media')
    await customerSays(t, 'שלום')
    await drain()
    sent = []

    await customerSays(t, '', { type: 'image' })
    await drain()
    expect(lastMessage()).toContain('בהודעת טקסט בלבד')

    await customerSays(t, '2')
    await drain()
    expect(lastMessage()).toContain('מה סוג האירוע?')
  })

  it('hands over after the configured number of unreadable answers', async () => {
    const t = await makeTenant('invalid')
    await customerSays(t, 'שלום')
    await drain()

    await customerSays(t, 'מה?')
    await drain()
    await customerSays(t, 'לא הבנתי')
    await drain()
    await customerSays(t, '???')
    await drain()

    const session = await sessionRow(t)
    expect(session?.status).toBe('handed_off')
    expect(session?.endedReason).toBe('invalid_limit')
  })
})

describe('tenant isolation', () => {
  it('keeps two businesses with the same customer number entirely apart', async () => {
    const a = await makeTenant('iso-a')
    const b = await makeTenant('iso-b')

    await customerSays(a, 'שלום')
    await drain()
    await customerSays(b, 'שלום')
    await drain()
    await customerSays(a, '1')
    await drain()

    const sessionA = await sessionRow(a)
    const sessionB = await sessionRow(b)
    expect(sessionA?.agencyId).toBe(a.agencyId)
    expect(sessionB?.agencyId).toBe(b.agencyId)
    expect(sessionA?.answers).toMatchObject({ services: ['stills'] })
    expect(sessionB?.answers).toEqual({})

    const crossed = await db('questionnaire_sessions')
      .where({ agencyId: a.agencyId, conversationId: b.conversationId })
      .first('id')
    expect(crossed).toBeFalsy()
  })
})
