import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { runAutoResponseWorker } from '@/lib/inbox/autoresponse/worker'
import { getAiState } from '@/db/conversationAiState'
import { loadCrmContext } from '@/lib/inbox/autoresponse/conversational/crmContext'
import type { QualifyGenResult } from '@/lib/inbox/autoresponse/qualify'
import type { ConversationalPromptContext } from '@/lib/inbox/autoresponse/conversational/prompt'

/**
 * The conversational auto-response END TO END against a real database: the
 * webhook's own ingest, the job queue, the worker with every gate, the send
 * gate, the AI-state memory and the notification queue. Only WhatsApp and the
 * model are faked. The fake model is SCRIPTED (each turn says what a real model
 * would return, mode included) and records every call, so "no model call" and
 * "the right context reached the model" are proven, not asserted. No message
 * leaves the test database.
 */

type Call = { transcript: Array<{ direction: string; text: string }>; conversational?: ConversationalPromptContext; greetingLine?: string | null; businessIdentityBlock?: string | null }
type Scripted = Partial<Extract<QualifyGenResult, { ok: true }>> | { ok: false; skipReason: 'ai_unavailable' } | ((call: Call) => Promise<Partial<Extract<QualifyGenResult, { ok: true }>>>)

let sent: Array<{ to: string; body: string }> = []
let calls: Call[] = []
let script: Scripted[] = []

const send = (async (args: { to: string; body: string }) => {
  sent.push({ to: args.to, body: args.body })
  return { ok: true, wamid: `wamid.out.${Math.random().toString(36).slice(2)}` }
}) as never

const base = (): Extract<QualifyGenResult, { ok: true }> => ({
  ok: true,
  reply: 'בשמחה, איך אפשר לעזור?',
  extracted: {},
  corrected: [],
  objective: 'discover_need',
  understanding: { pain: null, impact: null, currentWorkflow: null, desiredOutcome: null },
  salesMove: 'DISCOVERY',
  hotSignal: false,
  uncertain: false,
  model: 'scripted',
})

const generateQualify = (async (args: Call): Promise<QualifyGenResult> => {
  calls.push(args)
  const next = script.shift()
  if (next && 'ok' in next && next.ok === false) return next as QualifyGenResult
  const value = typeof next === 'function' ? await next(args) : next
  const out = { ...base(), ...(value ?? {}) }
  // The real generateQualifyTurn only returns the mode fields on a conversational call.
  if (!args.conversational) {
    delete (out as Record<string, unknown>).conversationMode
    delete (out as Record<string, unknown>).modeConfidence
    delete (out as Record<string, unknown>).personalClaims
    delete (out as Record<string, unknown>).escalationTopic
  }
  return out
}) as never

const generate = (async () => ({ ok: true, reply: 'תודה שפנית.' })) as never
const drain = () => runAutoResponseWorker({ deps: { send, generate, generateQualify }, workerId: `conv-${Math.random()}` })

const agencies: number[] = []
type Tenant = { agencyId: number; userId: number; leadId: number | null; conversationId: number; phoneNumberId: string; customerWaId: string }

async function makeTenant(suffix: string, opts: { leadStatus?: string | null; agentProfile?: Record<string, unknown> } = {}): Promise<Tenant> {
  const [a] = await db('agencies').insert({ name: `טליסמן ${suffix}`, autoResponseEnabled: true, plan: 'free', trialExempt: true }).returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [u] = await db('users').insert({ firstName: 'נ', role: 'ADMIN', agencyId }).returning('id')
  const userId = Number(u.id)
  const phoneNumberId = `conv_pn_${suffix}_${agencyId}`
  const customerWaId = `97254${String(agencyId).padStart(7, '0')}`
  await db('whatsapp_connections').insert({ user_id: userId, agency_id: agencyId, phone_number_id: phoneNumberId, access_token: 't' })
  await db('auto_response_settings').insert({
    agencyId,
    channel: 'whatsapp',
    enabled: true,
    mode: 'qualify',
    responder: 'agent',
    replyMode: 'ai',
    guidance: 'הפקת אירועים: חתונות, בר מצוות ואירועי חברה.',
    updatedBy: userId,
    ...(opts.agentProfile ? { agentProfile: JSON.stringify(opts.agentProfile) } : {}),
  })
  let leadId: number | null = null
  if (opts.leadStatus !== null) {
    const [c] = await db('clients')
      .insert({ firstName: 'דני', lastName: 'לוי', phone: customerWaId, agencyId, userId, handlerId: userId, createdById: userId, status: opts.leadStatus ?? 'new' })
      .returning('id')
    leadId = Number(c.id)
  }
  const [conv] = await db('inbox_conversations')
    .insert({ agencyId, leadId, channel: 'whatsapp', businessPhoneNumberId: phoneNumberId, customerWaId, customerName: 'דני לוי' })
    .returning('id')
  return { agencyId, userId, leadId, conversationId: Number(conv.id), phoneNumberId, customerWaId }
}

const says = (t: Tenant, body: string, extra: Record<string, unknown> = {}) =>
  ingestWhatsappInbound({
    agencyId: t.agencyId,
    leadId: t.leadId,
    businessPhoneNumberId: t.phoneNumberId,
    customerWaId: t.customerWaId,
    customerName: 'דני לוי',
    rawMessage: { id: `wamid.in.${Math.random().toString(36).slice(2)}`, from: t.customerWaId, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body }, ...extra },
  })

const memoryOf = async (t: Tenant) => (await getAiState(t.conversationId))?.qualification.conversation
const lastJob = async (t: Tenant) => (await db('auto_response_jobs').where({ conversationId: t.conversationId }).orderBy('id', 'desc').first('status', 'skipReason')) as { status: string; skipReason: string | null }
const personalNotices = (t: Tenant) => db('notification_jobs').where({ agencyId: t.agencyId, type: 'conversation.personal_detected' })
const noResponseJobs = (t: Tenant) => db('auto_response_jobs').where({ conversationId: t.conversationId }).whereIn('reason', ['no_response_warning', 'no_response_close'])

const personal = (reply: string, extra: Record<string, unknown> = {}): Scripted => ({ reply, salesMove: 'CASUAL_ACKNOWLEDGEMENT', conversationMode: 'personal', modeConfidence: 'high', personalClaims: false, escalationTopic: false, ...extra })
const business = (reply: string, mode = 'prospect', extra: Record<string, unknown> = {}): Scripted => ({ reply, conversationMode: mode as never, modeConfidence: 'high', personalClaims: false, escalationTopic: false, ...extra })

const ENV = ['IRE_CONVERSATIONAL_AGENCY_IDS', 'AGENT_RELIABILITY_AGENCY_IDS', 'NOTIFICATIONS_ENABLED', 'NOTIFICATIONS_AGENCY_ALLOWLIST'] as const
const saved: Record<string, string | undefined> = {}
let on: number[] = []
const enable = (...ids: number[]) => {
  on = ids
  process.env.IRE_CONVERSATIONAL_AGENCY_IDS = ids.join(',')
}

beforeAll(() => {
  for (const k of ENV) saved[k] = process.env[k]
  process.env.AGENT_RELIABILITY_AGENCY_IDS = 'all'
  process.env.NOTIFICATIONS_ENABLED = '1'
  process.env.NOTIFICATIONS_AGENCY_ALLOWLIST = 'all'
})
beforeEach(() => {
  sent = []
  calls = []
  script = []
  enable()
})
afterAll(async () => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  for (const t of ['analytics_events', 'notification_jobs', 'auto_response_jobs', 'conversation_turn_classification', 'conversation_ai_state', 'conversation_analysis_jobs', 'conversation_intelligence', 'qualify_draft_review', 'inbox_messages', 'inbox_participants', 'inbox_conversations', 'auto_response_settings']) {
    await db(t).whereIn('agencyId', agencies).del()
  }
  await db('meetings').whereIn('agency_id', agencies).del()
  await db('sales').whereIn('agencyId', agencies).del()
  await db('clients').whereIn('agencyId', agencies).del()
  await db('whatsapp_connections').whereIn('agency_id', agencies).del()
  await db('users').whereIn('agencyId', agencies).del()
  await db('agencies').whereIn('id', agencies).del()
})

describe('personal conversations', () => {
  it('"אחי מה קורה?" → one model call in conversational mode, a natural reply, no welcome line, one quiet notice', async () => {
    const t = await makeTenant('p1', { leadStatus: null })
    enable(t.agencyId)
    script = [personal('הכל טוב אחי, מה איתך?')]
    await says(t, 'אחי מה קורה?')
    await drain()
    expect(calls).toHaveLength(1)
    expect(calls[0].conversational?.crm.relationship).toBe('contact')
    expect(sent.map((s) => s.body)).toEqual(['הכל טוב אחי, מה איתך?'])
    expect(await memoryOf(t)).toMatchObject({ mode: 'personal', confidence: 'high', personalTurns: 1 })
    expect(await personalNotices(t)).toHaveLength(1)
  })

  it('"חחחח" continues the personal conversation (the sales rules would have closed it); a thumbs up gets no reply and does not close it', async () => {
    const t = await makeTenant('p2')
    enable(t.agencyId)
    script = [personal('הכל טוב אחי, מה איתך?')]
    await says(t, 'אחי מה קורה?')
    await drain()
    script = [personal('חחחחחח 😂')]
    await says(t, 'חחחח הרגת אותי')
    await drain()
    expect(sent.map((s) => s.body)).toEqual(['הכל טוב אחי, מה איתך?', 'חחחחחח 😂'])
    await says(t, '👍')
    await drain()
    expect(calls).toHaveLength(2) // no model call for the thumbs up
    expect(await lastJob(t)).toMatchObject({ status: 'skipped', skipReason: 'social_ack' })
    expect((await getAiState(t.conversationId))?.aiState).not.toBe('closed')
    // Still one notice, and a friend is never asked "are you still there?".
    expect(await personalNotices(t)).toHaveLength(1)
    expect(await noResponseJobs(t)).toHaveLength(0)
  })

  it('a commitment on the owner\'s behalf is never sent: one repair call, then the safe reply', async () => {
    const t = await makeTenant('p3')
    enable(t.agencyId)
    script = [personal('ברור! ניפגש מחר בערב אצלי'), personal('חחח ברור אחי, עבר מלא זמן!')]
    await says(t, 'מתגעגע אחי, חייבים להיפגש')
    await drain()
    expect(calls).toHaveLength(2)
    expect(calls[1].conversational?.personalRepair).toBe(true)
    expect(sent.map((s) => s.body)).toEqual(['חחח ברור אחי, עבר מלא זמן!'])
  })

  it('an invented owner fact that survives the repair → nothing is sent, no business fallback, no handoff', async () => {
    const t = await makeTenant('p4')
    enable(t.agencyId)
    script = [personal('אני בעבודה עכשיו, נדבר אחר כך'), personal('אני כרגע בדרך')]
    await says(t, 'איפה אתה?')
    await drain()
    expect(sent).toHaveLength(0)
    expect(await lastJob(t)).toMatchObject({ status: 'skipped', skipReason: 'conversational_reply_refused' })
    expect((await getAiState(t.conversationId))?.aiState).not.toBe('escalated')
  })

  it('the model saying it made a claim (personalClaims) stops the reply the same way', async () => {
    const t = await makeTenant('p5')
    enable(t.agencyId)
    script = [personal('סבבה', { personalClaims: true }), personal('חחח מה איתך?')]
    await says(t, 'מה אתה עושה היום?')
    await drain()
    expect(sent.map((s) => s.body)).toEqual(['חחח מה איתך?'])
  })
})

describe('business conversations', () => {
  it('a prospect is welcomed with the owner\'s own greeting and answered from the business facts', async () => {
    const t = await makeTenant('b1', { agentProfile: { greeting: 'היי, ברוכים הבאים לטליסמן! 😊', tone: 'warm', faq: [{ question: 'כמה עולה חתונה?', answer: 'המחיר לפי מספר אורחים, מ-180 ₪ למנה' }] } })
    enable(t.agencyId)
    script = [business('היי, ברוכים הבאים לטליסמן! 😊 בשמחה, איזה סוג אירוע אתם מתכננים?')]
    await says(t, 'שלום, רציתי לברר לגבי אירוע')
    await drain()
    expect(calls[0].greetingLine).toBe('היי, ברוכים הבאים לטליסמן! 😊')
    expect(calls[0].businessIdentityBlock).toContain('ש: כמה עולה חתונה?')
    expect(sent).toHaveLength(1)
    expect(await personalNotices(t)).toHaveLength(0)
  })

  it('a price that is only in the owner\'s FAQ is a verified fact, so the reply is allowed', async () => {
    const t = await makeTenant('b2', { agentProfile: { faq: [{ question: 'כמה עולה חתונה?', answer: 'מ-180 ₪ למנה' }] } })
    enable(t.agencyId)
    // No hyphen: the existing customer-text sanitizer rewrites "מ-180" as "מ, 180".
    script = [business('המחיר הוא 180 ₪ למנה, לפי מספר האורחים. לכמה מוזמנים אתם מתכננים?', 'pricing')]
    await says(t, 'כמה עולה חתונה?')
    await drain()
    expect(calls).toHaveLength(1) // passed the validator the first time: the FAQ grounds the figure
    expect(sent.map((s) => s.body)).toEqual(['המחיר הוא 180 ₪ למנה, לפי מספר האורחים. לכמה מוזמנים אתם מתכננים?'])
  })

  it('a topic the owner wants a person for is handed off, with the handoff copy, never answered by the agent', async () => {
    const t = await makeTenant('b3', { agentProfile: { escalationTopics: ['ביטול אירוע והחזר כספי'] } })
    enable(t.agencyId)
    script = [business('אפשר לבטל ולקבל החזר מלא', 'support', { escalationTopic: true })]
    await says(t, 'אני רוצה לבטל את האירוע ולקבל את הכסף בחזרה')
    await drain()
    expect(sent).toHaveLength(1)
    expect(sent[0].body).not.toContain('החזר מלא')
    expect(sent[0].body).toContain('ממתינה כעת לטיפול הצוות')
    expect((await getAiState(t.conversationId))?.aiState).toBe('escalated')
  })
})

describe('mixed conversations and transitions', () => {
  it('personal → business → personal: the mode follows the message, the memory follows the mode', async () => {
    const t = await makeTenant('m1')
    enable(t.agencyId)
    script = [personal('הכל טוב אחי, מה איתך?')]
    await says(t, 'אחי מה קורה?')
    await drain()
    script = [business('בטח, עושים גם אירועים קטנים. לכמה אנשים בערך?', 'mixed')]
    await says(t, 'תגיד, אתם עושים גם אירועים קטנים?')
    await drain()
    expect(await memoryOf(t)).toMatchObject({ mode: 'mixed', personalTurns: 1 })
    expect(calls[1].conversational?.memory).toMatchObject({ mode: 'personal' })
    script = [personal('הכל טוב, עמוס אבל כיף. ואצלך?')]
    await says(t, 'סבבה נדבר על זה, מה איתך בכללי?')
    await drain()
    expect(sent).toHaveLength(3)
    expect(await memoryOf(t)).toMatchObject({ mode: 'personal', personalTurns: 2 })
    expect(await personalNotices(t)).toHaveLength(1)
  })
})

describe('scheduling requests stay business even when the model reads them as personal', () => {
  it.each([
    'אחי אפשר לקבוע למחר?',
    'מה קורה, יש לכם מקום בחמישי?',
    'אני רוצה לסגור איתכם תאריך',
  ])('"%s" + a model that says personal → corrected to scheduling and handed to the team', async (text) => {
    const t = await makeTenant(`sch${Math.random().toString(36).slice(2, 7)}`)
    enable(t.agencyId)
    script = [personal('חחח ברור אחי, מתי שבא לך')]
    await says(t, text)
    await drain()
    expect(calls).toHaveLength(1)
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toContain('ממתינה כעת לטיפול הצוות')
    expect(sent[0].body).not.toContain('מתי שבא לך')
    expect((await getAiState(t.conversationId))?.aiState).toBe('escalated')
    expect(await memoryOf(t)).toMatchObject({ mode: 'scheduling' })
    expect(await personalNotices(t)).toHaveLength(0)
  })

  it('an existing customer asking to move the appointment ("תזיז לי את הפגישה לשבוע הבא") is handed to the team', async () => {
    const t = await makeTenant('sch_move', { leadStatus: 'closed' })
    enable(t.agencyId)
    script = [personal('סבבה אחי, אין בעיה')]
    await says(t, 'תזיז לי את הפגישה לשבוע הבא')
    await drain()
    expect(sent.at(-1)?.body).toContain('ממתינה כעת לטיפול הצוות')
    expect((await getAiState(t.conversationId))?.aiState).toBe('escalated')
  })

  it('when the model already reads it as business, the existing behaviour is unchanged: the answer is sent', async () => {
    const t = await makeTenant('sch_ok')
    enable(t.agencyId)
    script = [business('אין לי אפשרות לבדוק זמינות מכאן. לאיזה חודש התכוונתם?', 'scheduling')]
    await says(t, 'מה קורה, יש לכם מקום בחמישי?')
    await drain()
    expect(sent.map((x) => x.body)).toEqual(['אין לי אפשרות לבדוק זמינות מכאן. לאיזה חודש התכוונתם?'])
  })

  it('a friend\'s "חייבים להיפגש" is not a scheduling request: the personal reply is sent', async () => {
    const t = await makeTenant('sch_friend')
    enable(t.agencyId)
    script = [personal('חחח ברור אחי, עבר מלא זמן!')]
    await says(t, 'מתגעגע אחי, חייבים להיפגש')
    await drain()
    expect(sent.map((x) => x.body)).toEqual(['חחח ברור אחי, עבר מלא זמן!'])
  })
})

describe('existing customers and finished leads', () => {
  it('a closed lead is an existing customer: answered with the relationship, the next appointment, and no welcome', async () => {
    const t = await makeTenant('c1', { leadStatus: 'closed' })
    enable(t.agencyId)
    const start = new Date(Date.now() + 3 * 86_400_000)
    await db('meetings').insert({ agency_id: t.agencyId, organizer_user_id: t.userId, lead_id: t.leadId, title: 'פגישת תיאום', timezone: 'Asia/Jerusalem', start_at: start, end_at: new Date(start.getTime() + 3_600_000), status: 'scheduled' })
    script = [business('כן, הפגישה שלך קבועה. משהו נוסף שתרצה לבדוק?', 'existing_customer')]
    await says(t, 'היי, רק מוודא שהפגישה שלנו בתוקף')
    await drain()
    expect(calls).toHaveLength(1)
    expect(calls[0].conversational?.crm).toMatchObject({ relationship: 'existing_customer', leadStatus: 'closed' })
    expect(calls[0].conversational?.crm.nextMeeting?.startAtMs).toBe(start.getTime())
    expect(calls[0].greetingLine).toBeNull()
    expect(sent).toHaveLength(1)
  })

  it('without the flag a closed lead is still skipped, exactly as before', async () => {
    const t = await makeTenant('c2', { leadStatus: 'closed' })
    await says(t, 'היי, רק מוודא שהפגישה שלנו בתוקף')
    await drain()
    expect(calls).toHaveLength(0)
    expect(await lastJob(t)).toMatchObject({ status: 'skipped', skipReason: 'lead_terminal' })
  })

  it('a lost lead is never treated as a customer: still skipped with the flag on', async () => {
    const t = await makeTenant('c3', { leadStatus: 'lost' })
    enable(t.agencyId)
    await says(t, 'היי')
    await drain()
    expect(calls).toHaveLength(0)
    expect(await lastJob(t)).toMatchObject({ status: 'skipped', skipReason: 'lead_terminal' })
  })

  it('a lead with a completed sale is an existing customer even before its status says so', async () => {
    const t = await makeTenant('c4', { leadStatus: 'interested' })
    await db('sales').insert({ status: 'פעיל', company: 'x', branch: 'x', prdct: 'אירוע', prdctType: 'חד פעמי', offrDt: new Date(), saleDt: new Date(), clientId: t.leadId, createdById: t.userId, amount: 1000, agencyId: t.agencyId })
    const crm = await loadCrmContext({ agencyId: t.agencyId, leadId: t.leadId, nowMs: Date.now() })
    expect(crm).toMatchObject({ relationship: 'existing_customer', completedSales: 1 })
  })

  it('tenant isolation: another agency\'s lead id yields nothing at all', async () => {
    const mine = await makeTenant('c5', { leadStatus: 'closed' })
    const other = await makeTenant('c6')
    const crm = await loadCrmContext({ agencyId: other.agencyId, leadId: mine.leadId, nowMs: Date.now() })
    expect(crm).toEqual({ relationship: 'contact', leadStatus: null, completedSales: 0, lastSaleAtMs: null, nextMeeting: null, lastMeeting: null })
  })
})

describe('every protection still holds', () => {
  it('a conversation the owner marked personal: no model call, no send, whatever the flag', async () => {
    const t = await makeTenant('s1', { leadStatus: null })
    enable(t.agencyId)
    await db('inbox_conversations').where({ id: t.conversationId }).update({ isPersonal: true })
    await says(t, 'אחי מה קורה?')
    await drain()
    expect(calls).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })

  it('marked personal AFTER the reply was generated: the send gate refuses it', async () => {
    const t = await makeTenant('s2', { leadStatus: null })
    enable(t.agencyId)
    script = [
      async () => {
        await db('inbox_conversations').where({ id: t.conversationId }).update({ isPersonal: true })
        return personal('הכל טוב אחי, מה איתך?') as never
      },
    ]
    await says(t, 'אחי מה קורה?')
    await drain()
    expect(calls).toHaveLength(1)
    expect(sent).toHaveLength(0)
    expect(await personalNotices(t)).toHaveLength(0)
  })

  it('an opt-out is never answered by the model, friend or not', async () => {
    const t = await makeTenant('s3')
    enable(t.agencyId)
    script = [personal('הכל טוב אחי, מה איתך?')]
    await says(t, 'אחי מה קורה?')
    await drain()
    await says(t, 'תפסיק לשלוח לי הודעות')
    await drain()
    expect(calls).toHaveLength(1)
    expect((await getAiState(t.conversationId))?.aiState).toBe('opted_out')
  })

  it('outside the 24-hour service window nothing is generated', async () => {
    const t = await makeTenant('s4')
    enable(t.agencyId)
    await says(t, 'אחי מה קורה?', { timestamp: String(Math.floor((Date.now() - 25 * 3_600_000) / 1000)) })
    await drain()
    expect(calls).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })

  it('a model failure sends nothing and leaves the job to the existing retry', async () => {
    const t = await makeTenant('s5')
    enable(t.agencyId)
    script = [{ ok: false, skipReason: 'ai_unavailable' }]
    await says(t, 'שלום, רציתי לקבל פרטים')
    await drain()
    expect(sent).toHaveLength(0)
    expect((await lastJob(t)).status).not.toBe('done')
  })

  it('a duplicate inbound event (same wamid) produces one job and one reply', async () => {
    const t = await makeTenant('s6')
    enable(t.agencyId)
    script = [business('בשמחה, איזה סוג אירוע?')]
    const raw = { id: 'wamid.dup.conversational', from: t.customerWaId, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'שלום, רציתי לקבל פרטים' } }
    const input = { agencyId: t.agencyId, leadId: t.leadId, businessPhoneNumberId: t.phoneNumberId, customerWaId: t.customerWaId, customerName: 'דני לוי', rawMessage: raw }
    await ingestWhatsappInbound(input)
    await ingestWhatsappInbound(input)
    await drain()
    expect(await db('auto_response_jobs').where({ conversationId: t.conversationId, reason: 'qualify_turn' })).toHaveLength(1)
    expect(sent).toHaveLength(1)
  })

  it('a claimed booking ("קבעתי לך") is refused by the existing validator in a business turn too', async () => {
    const t = await makeTenant('s7')
    enable(t.agencyId)
    script = [business('קבעתי לך פגישה למחר ב-10', 'scheduling'), business('קבעתי לך פגישה למחר ב-10', 'scheduling')]
    await says(t, 'אפשר לקבוע פגישה?')
    await drain()
    expect(sent.every((s) => !s.body.includes('קבעתי'))).toBe(true)
  })

  it('the flag is per agency: an agency not on it runs the classic prompt and the classic meeting handoff', async () => {
    const t = await makeTenant('s8')
    const other = await makeTenant('s9')
    enable(other.agencyId)
    script = [{ reply: 'מה הכי חשוב לך שנסדר?' }]
    await says(t, 'אני צריך עזרה עם אירוע')
    await drain()
    expect(calls).toHaveLength(1)
    expect(calls[0].conversational).toBeUndefined()
    // Classic: a meeting mention is a handoff before any model call.
    await says(t, 'מתגעגע אחי, חייבים להיפגש')
    await drain()
    expect(calls).toHaveLength(1)
    expect(sent.at(-1)?.body).toContain('ממתינה כעת לטיפול הצוות')
    expect(on).toEqual([other.agencyId])
  })

  it('an explicit request for a person still hands off before the model, friend or not', async () => {
    const t = await makeTenant('s10')
    enable(t.agencyId)
    await says(t, 'אפשר לדבר עם נציג?')
    await drain()
    expect(calls).toHaveLength(0)
    expect(sent.at(-1)?.body).toContain('ממתינה כעת לטיפול הצוות')
  })

  it('a prospect\'s new booking need is still handed to the team after the model reads it', async () => {
    const t = await makeTenant('s11')
    enable(t.agencyId)
    script = [business('נשמח! לאיזה תאריך חשבתם?', 'scheduling')]
    await says(t, 'אפשר לקבוע פגישה לגבי החתונה?')
    await drain()
    expect(calls).toHaveLength(1)
    expect(sent.at(-1)?.body).toContain('ממתינה כעת לטיפול הצוות')
    expect((await getAiState(t.conversationId))?.aiState).toBe('escalated')
  })
})
