import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { ingestWhatsappEchoes } from '@/lib/inbox/ingestWhatsappEcho'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { runAutoResponseWorker } from '@/lib/inbox/autoresponse/worker'
import { enqueueAutoResponse } from '@/db/autoResponseJobs'
import { getAiState, markClosed, markStopped } from '@/db/conversationAiState'
import { returnConversationToAgent, takeOverConversationByRep } from '@/db/conversationHumanPresence'
import { aiRepliesPausedForPlan } from '@/lib/inbox/autoresponse/reliability/entitlement'
import type { QualifyGenResult } from '@/lib/inbox/autoresponse/qualify'

/**
 * Ownership + silence correctness (AGENT_RELIABILITY_AGENCY_IDS), end to end
 * against a real database: the webhook's own ingest (inbound and Coexistence
 * echoes), the job queue, the worker, the ownership actions. Only WhatsApp and
 * the model are faked — and both COUNT, which is how "no model call" is proven
 * rather than asserted.
 */

type Sent = { to: string; body: string }
let sent: Sent[] = []
let modelCalls: Array<{ transcript: Array<{ direction: string; text: string }> }> = []
let ackCalls = 0

const send = (async (args: { to: string; body: string }) => {
  sent.push({ to: args.to, body: args.body })
  return { ok: true, wamid: `wamid.out.${Math.random().toString(36).slice(2)}` }
}) as never

const generateQualify = (async (args: { transcript: Array<{ direction: string; text: string }> }): Promise<QualifyGenResult> => {
  modelCalls.push({ transcript: args.transcript })
  return {
    ok: true,
    reply: 'מה הכי חשוב לך שנסדר?',
    extracted: {},
    corrected: [],
    objective: 'discover_need',
    understanding: { pain: null, impact: null, currentWorkflow: null, desiredOutcome: null },
    salesMove: 'DISCOVERY',
    hotSignal: false,
    uncertain: false,
    model: 'fake',
  }
}) as never

const generate = (async () => {
  ackCalls++
  return { ok: true, reply: 'תודה שפנית, נחזור אלייך בהקדם.' }
}) as never

const drain = () => runAutoResponseWorker({ deps: { send, generate, generateQualify }, workerId: `rel-${Math.random()}` })

const agencies: number[] = []
type Tenant = { agencyId: number; userId: number; leadId: number; conversationId: number; phoneNumberId: string; customerWaId: string }

async function makeTenant(
  suffix: string,
  opts: { entitled?: boolean; responder?: 'agent' | 'questionnaire'; mode?: 'qualify' | 'acknowledge'; replyMode?: 'ai' | 'fixed' } = {},
): Promise<Tenant> {
  const entitled = opts.entitled ?? true
  const past = new Date(Date.now() - 30 * 86_400_000)
  const [a] = await db('agencies')
    .insert({
      name: `עסק ${suffix}`,
      autoResponseEnabled: true,
      plan: 'free',
      // LEGACY (trialExempt) has the product; an ended trial does not. Same
      // classification the router's entitlement gate uses.
      trialExempt: entitled,
      trialStartedAt: entitled ? null : past,
      trialEndsAt: entitled ? null : new Date(past.getTime() + 7 * 86_400_000),
    })
    .returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [u] = await db('users').insert({ firstName: 'נ', role: 'ADMIN', agencyId }).returning('id')
  const userId = Number(u.id)
  const phoneNumberId = `rel_pn_${suffix}_${agencyId}`
  const customerWaId = `97255${String(agencyId).padStart(7, '0')}`
  await db('whatsapp_connections').insert({ user_id: userId, agency_id: agencyId, phone_number_id: phoneNumberId, access_token: 't' })
  await db('auto_response_settings').insert({
    agencyId,
    channel: 'whatsapp',
    enabled: true,
    mode: opts.mode ?? 'qualify',
    responder: opts.responder ?? 'agent',
    replyMode: opts.replyMode ?? 'ai',
    fixedBody: opts.replyMode === 'fixed' ? 'תודה, נחזור אלייך.' : null,
    updatedBy: userId,
  })
  const [c] = await db('clients')
    .insert({ firstName: 'דנה', lastName: 'כהן', phone: customerWaId, agencyId, userId, handlerId: userId, createdById: userId, status: 'new' })
    .returning('id')
  const [conv] = await db('inbox_conversations')
    .insert({ agencyId, leadId: Number(c.id), channel: 'whatsapp', businessPhoneNumberId: phoneNumberId, customerWaId })
    .returning('id')
  return { agencyId, userId, leadId: Number(c.id), conversationId: Number(conv.id), phoneNumberId, customerWaId }
}

/** Exactly what the webhook does with one customer message. */
async function customer(t: Tenant, message: Record<string, unknown>) {
  return ingestWhatsappInbound({
    agencyId: t.agencyId,
    leadId: t.leadId,
    businessPhoneNumberId: t.phoneNumberId,
    customerWaId: t.customerWaId,
    customerName: 'דנה כהן',
    rawMessage: { id: `wamid.in.${Math.random().toString(36).slice(2)}`, from: t.customerWaId, timestamp: String(Math.floor(Date.now() / 1000)), ...message },
  })
}
const says = (t: Tenant, body: string) => customer(t, { type: 'text', text: { body } })

/** The owner answering from the WhatsApp Business app (Coexistence), through the real echo ingest. */
const ownerRepliesFromPhone = (t: Tenant, body: string) =>
  ingestWhatsappEchoes({
    metadata: { phone_number_id: t.phoneNumberId },
    message_echoes: [
      { id: `wamid.echo.${Math.random().toString(36).slice(2)}`, from: '972500000000', to: t.customerWaId, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } },
    ],
  })

/** A rep's reply from SocialCRM: a user, no source — how the composer persists it. */
const repReplies = (t: Tenant, text: string) =>
  persistOutboundWhatsapp({
    agencyId: t.agencyId,
    leadId: t.leadId,
    businessPhoneNumberId: t.phoneNumberId,
    customerWaId: t.customerWaId,
    customerName: 'דנה כהן',
    sentByUserId: t.userId,
    wamid: `wamid.rep.${Math.random().toString(36).slice(2)}`,
    text,
  })

/** An automation template send: no user, no source — how the automation executor persists it. */
const automationSends = (t: Tenant, text: string) =>
  persistOutboundWhatsapp({
    agencyId: t.agencyId,
    leadId: t.leadId,
    businessPhoneNumberId: t.phoneNumberId,
    customerWaId: t.customerWaId,
    customerName: 'דנה כהן',
    sentByUserId: null,
    wamid: `wamid.auto.${Math.random().toString(36).slice(2)}`,
    text,
  })

/** Give the conversation an earlier agent turn, so the next message is not a first contact. */
async function agentAlreadySpoke(t: Tenant) {
  await says(t, 'אני צריכה עזרה עם הזמנה')
  await drain()
  sent = []
  modelCalls = []
}

const state = async (t: Tenant) => (await getAiState(t.conversationId))?.aiState
const jobsFor = (t: Tenant) => db('auto_response_jobs').where({ conversationId: t.conversationId }).orderBy('id')
const lastJob = async (t: Tenant) => (await jobsFor(t)).at(-1)

let saved: string | undefined
beforeAll(() => {
  saved = process.env.AGENT_RELIABILITY_AGENCY_IDS
  process.env.NOTIFICATIONS_ENABLED = '1'
  process.env.NOTIFICATIONS_AGENCY_ALLOWLIST = 'all'
})
beforeEach(() => {
  sent = []
  modelCalls = []
  ackCalls = 0
  process.env.AGENT_RELIABILITY_AGENCY_IDS = 'all'
})
afterAll(async () => {
  if (saved === undefined) delete process.env.AGENT_RELIABILITY_AGENCY_IDS
  else process.env.AGENT_RELIABILITY_AGENCY_IDS = saved
  delete process.env.NOTIFICATIONS_ENABLED
  delete process.env.NOTIFICATIONS_AGENCY_ALLOWLIST
  delete process.env.WA_QUESTIONNAIRE_ENABLED
  delete process.env.WA_QUESTIONNAIRE_AGENCY_IDS
  await db('analytics_events').whereIn('agencyId', agencies).del()
  await db('notification_jobs').whereIn('agencyId', agencies).del()
  await db('questionnaire_sessions').whereIn('agencyId', agencies).del()
  await db('auto_response_jobs').whereIn('agencyId', agencies).del()
  await db('conversation_turn_classification').whereIn('agencyId', agencies).del()
  await db('conversation_ai_state').whereIn('agencyId', agencies).del()
  await db('conversation_analysis_jobs').whereIn('agencyId', agencies).del()
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

describe('an exclusive job lease', () => {
  it('a job taken over mid-turn sends nothing and is counted as leaseLost, not failed', async () => {
    const t = await makeTenant('lease-lost')
    await agentAlreadySpoke(t)
    await says(t, 'אפשר להזיז לשעה אחרת?')
    // While this worker generates, another worker takes the job over.
    const thief = (async (args: { transcript: Array<{ direction: string; text: string }> }) => {
      await db('auto_response_jobs').where({ conversationId: t.conversationId, status: 'processing' }).update({ lockedBy: 'another-worker' })
      return (generateQualify as unknown as (a: typeof args) => Promise<QualifyGenResult>)(args)
    }) as never
    const r = await runAutoResponseWorker({ deps: { send, generate, generateQualify: thief }, workerId: `rel-${Math.random()}` })
    expect(r).toMatchObject({ claimed: 1, sent: 0, failed: 0, leaseLost: 1 })
    expect(sent).toHaveLength(0) // the fence refused the send
    expect(await lastJob(t)).toMatchObject({ status: 'processing', lockedBy: 'another-worker' }) // untouched: the new owner decides
  })
})

describe('what counts as a human taking over', () => {
  it('an automation template is NOT a takeover (1)', async () => {
    const t = await makeTenant('auto')
    await agentAlreadySpoke(t)
    await automationSends(t, 'תזכורת: התור שלך מחר')
    await says(t, 'אפשר להזיז לשעה אחרת?')
    await drain()
    expect(await state(t)).not.toBe('human_active')
    expect(modelCalls).toHaveLength(1)
    expect(sent).toHaveLength(1)
  })

  it('the same template still silences the agent for an agency outside the rollout (flag gates it)', async () => {
    const t = await makeTenant('auto-legacy')
    process.env.AGENT_RELIABILITY_AGENCY_IDS = ''
    await agentAlreadySpoke(t)
    await automationSends(t, 'תזכורת: התור שלך מחר')
    await says(t, 'אפשר להזיז לשעה אחרת?')
    await drain()
    expect(await state(t)).toBe('human_active')
    expect(sent).toHaveLength(0)
  })

  it('a rep reply from SocialCRM IS a takeover (2)', async () => {
    const t = await makeTenant('rep')
    await agentAlreadySpoke(t)
    await repReplies(t, 'היי דנה, כאן נועה')
    await says(t, 'מעולה, מתי נוח לדבר?')
    await drain()
    expect(await state(t)).toBe('human_active')
    expect(modelCalls).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })

  it('a reply from the WhatsApp Business app (Coexistence echo) IS a takeover (3)', async () => {
    const t = await makeTenant('echo')
    await agentAlreadySpoke(t)
    await ownerRepliesFromPhone(t, 'היי, אני אחזור אלייך עוד שעה')
    await says(t, 'בסדר גמור')
    await drain()
    expect(await state(t)).toBe('human_active')
    expect(modelCalls).toHaveLength(0)
    expect(sent).toHaveLength(0)
  })
})

describe('return to agent', () => {
  it('the next customer message is answered despite the rep’s earlier messages (4)', async () => {
    const t = await makeTenant('return')
    await agentAlreadySpoke(t)
    await repReplies(t, 'היי דנה, כאן נועה')
    await takeOverConversationByRep({ conversationId: t.conversationId, agencyId: t.agencyId })
    expect(await returnConversationToAgent({ conversationId: t.conversationId, agencyId: t.agencyId })).toBe(true)
    const q = (await getAiState(t.conversationId))?.qualification
    expect(q?.ownership?.sinceSequence).toBeGreaterThan(0)

    await says(t, 'יש לכם גם משלוחים?')
    await drain()
    expect(await state(t)).toBe('ai_qualifying')
    expect(modelCalls).toHaveLength(1)
    expect(sent).toHaveLength(1)
    // The epoch survives the agent's own turn being recorded.
    expect((await getAiState(t.conversationId))?.qualification?.ownership?.sinceSequence).toBe(q?.ownership?.sinceSequence)
  })

  it('a NEW human reply after the return takes the conversation again (5)', async () => {
    const t = await makeTenant('retake')
    await agentAlreadySpoke(t)
    await repReplies(t, 'היי דנה, כאן נועה')
    await takeOverConversationByRep({ conversationId: t.conversationId, agencyId: t.agencyId })
    await returnConversationToAgent({ conversationId: t.conversationId, agencyId: t.agencyId })
    await ownerRepliesFromPhone(t, 'אני כאן שוב')
    await says(t, 'יש לכם גם משלוחים?')
    await drain()
    expect(await state(t)).toBe('human_active')
    expect(sent).toHaveLength(0)
  })
})

describe('a first message that only says hello', () => {
  it('"היי" gets the business greeting and an opening question, with no model call (6)', async () => {
    const t = await makeTenant('hi')
    await says(t, 'היי')
    await drain()
    expect(modelCalls).toHaveLength(0)
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toBe('היי, ברוך הבא לעסק hi 👋 איך אפשר לעזור?')
    const out = await db('inbox_messages').where({ conversationId: t.conversationId, direction: 'outbound' }).first('metadata')
    expect(out.metadata).toMatchObject({ source: 'auto_response', kind: 'opening' })
    expect(await state(t)).toBe('ai_qualifying')
    const turn = (await jobsFor(t)).find((j) => j.reason === 'qualify_turn')
    expect(turn).toMatchObject({ status: 'sent', skipReason: null })
  })

  it.each([['שלום'], ['היי!!'], ['הייייי'], ['👋'], ['?'], ['hi']])('"%s" is an opener too (7)', async (text) => {
    const t = await makeTenant(`hi-${Math.random().toString(36).slice(2, 6)}`)
    await says(t, text)
    await drain()
    expect(modelCalls).toHaveLength(0)
    expect(sent).toHaveLength(1)
  })

  it('two greetings in a row are answered once (7)', async () => {
    const t = await makeTenant('hi-twice')
    await says(t, 'היי')
    await says(t, 'שלום')
    await drain()
    expect(modelCalls).toHaveLength(0)
    expect(sent).toHaveLength(1)
  })

  it('a greeting that carries a question still goes to the model (7)', async () => {
    const t = await makeTenant('hi-q')
    await says(t, 'היי, כמה עולה טיפול פנים?')
    await drain()
    expect(modelCalls).toHaveLength(1)
  })

  it('a later "היי" in a conversation already under way is never greeted again (7)', async () => {
    const t = await makeTenant('hi-later')
    await agentAlreadySpoke(t)
    await says(t, 'היי')
    await drain()
    expect(sent.every((s) => !s.body.includes('ברוך הבא'))).toBe(true)
  })
})

describe('media', () => {
  it('an image caption is read as the customer’s text, and the attachment is kept (8)', async () => {
    const t = await makeTenant('caption')
    await agentAlreadySpoke(t)
    await customer(t, { type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'המסך נסדק, כמה עולה להחליף?' } })
    await drain()
    expect(modelCalls).toHaveLength(1)
    const lastInbound = modelCalls[0].transcript.filter((m) => m.direction === 'inbound').at(-1)
    expect(lastInbound?.text).toBe('המסך נסדק, כמה עולה להחליף?')
    const row = await db('inbox_messages').where({ conversationId: t.conversationId, direction: 'inbound', type: 'image' }).first('text', 'payload')
    expect(row.text).toBe('')
    expect(row.payload).toMatchObject({ id: 'media-1', caption: 'המסך נסדק, כמה עולה להחליף?' })
  })

  it('a photo alone gets an honest acknowledgement, never an interpretation, and no model call (9)', async () => {
    const t = await makeTenant('photo')
    await agentAlreadySpoke(t)
    await customer(t, { type: 'image', image: { id: 'media-2', mime_type: 'image/jpeg' } })
    await drain()
    expect(modelCalls).toHaveLength(0)
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toBe('קיבלתי, תודה. אפשר לכתוב לי בכמה מילים במה מדובר?')

    // A second photo before any words: not acknowledged again.
    await customer(t, { type: 'image', image: { id: 'media-3', mime_type: 'image/jpeg' } })
    await drain()
    expect(sent).toHaveLength(1)
    expect(modelCalls).toHaveLength(0)
  })

  it('a voice note is acknowledged as a recording we cannot play, with no model call (9)', async () => {
    const t = await makeTenant('voice')
    await customer(t, { type: 'audio', audio: { id: 'media-4', voice: true } })
    await drain()
    expect(modelCalls).toHaveLength(0)
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toBe('היי, ברוך הבא לעסק voice 👋 קיבלתי את ההקלטה. כרגע אין לי אפשרות להאזין להקלטות כאן, אפשר לכתוב לי בכמה מילים?')
  })

  it.each([
    ['sticker', { type: 'sticker', sticker: { id: 's' } }],
    ['reaction', { type: 'reaction', reaction: { message_id: 'x', emoji: '👍' } }],
  ])('a %s gets silence, not a reply (9)', async (_label, message) => {
    const t = await makeTenant(`quiet-${Math.random().toString(36).slice(2, 6)}`)
    await agentAlreadySpoke(t)
    await customer(t, message as Record<string, unknown>)
    await drain()
    expect(sent).toHaveLength(0)
    expect(modelCalls).toHaveLength(0)
  })
})

describe('closed conversations', () => {
  it('a legitimate new question reopens it, and it stays open (10)', async () => {
    const t = await makeTenant('reopen')
    await agentAlreadySpoke(t)
    await markClosed(t.conversationId, 'no_response')
    await says(t, 'יש לכם שירות גם בשבת?')
    await drain()
    expect(sent).toHaveLength(1)
    expect(await state(t)).toBe('ai_qualifying')

    await says(t, 'אני גרה בחולון')
    await drain()
    expect((await lastJob(t)).skipReason).not.toBe('closed')
    expect(modelCalls).toHaveLength(2)
  })

  it('an opted-out conversation does not reopen (11)', async () => {
    const t = await makeTenant('opted')
    await agentAlreadySpoke(t)
    await markStopped(t.conversationId, 'opted_out', 'opt_out')
    await says(t, 'יש לכם שירות גם בשבת?')
    await drain()
    expect(sent).toHaveLength(0)
    expect(modelCalls).toHaveLength(0)
    expect(await state(t)).toBe('opted_out')
  })

  it('a conversation a person answered after it closed stays with the person (12)', async () => {
    const t = await makeTenant('closed-human')
    await agentAlreadySpoke(t)
    await markClosed(t.conversationId, 'no_response')
    await ownerRepliesFromPhone(t, 'היי דנה, ראיתי את ההודעה')
    await says(t, 'יש לכם שירות גם בשבת?')
    await drain()
    expect(sent).toHaveLength(0)
    expect(await state(t)).toBe('human_active')
  })

  it('a human-owned conversation is never reopened by a customer message (12)', async () => {
    const t = await makeTenant('human-owned')
    await agentAlreadySpoke(t)
    await takeOverConversationByRep({ conversationId: t.conversationId, agencyId: t.agencyId })
    await says(t, 'יש לכם שירות גם בשבת?')
    await drain()
    expect(sent).toHaveLength(0)
    expect(await state(t)).toBe('human_active')
  })
})

describe('an agency whose plan does not include the AI reply', () => {
  it('gets no model call and no doomed job; the message is kept and notified (13, 14, 15)', async () => {
    const t = await makeTenant('unpaid', { entitled: false })
    await says(t, 'שלום, רציתי לשאול על מחירים')
    const r = await drain()
    expect(modelCalls).toHaveLength(0)
    expect(ackCalls).toBe(0)
    expect(sent).toHaveLength(0)
    expect(await jobsFor(t)).toHaveLength(0)
    expect(r.claimed).toBe(0)
    const inbound = await db('inbox_messages').where({ conversationId: t.conversationId, direction: 'inbound' })
    expect(inbound).toHaveLength(1)
    expect(inbound[0].text).toBe('שלום, רציתי לשאול על מחירים')
    // Visible in the inbox exactly as before: the conversation row moved.
    const conv = await db('inbox_conversations').where({ id: t.conversationId }).first('lastMessageText', 'lastDirection')
    expect(conv).toMatchObject({ lastMessageText: 'שלום, רציתי לשאול על מחירים', lastDirection: 'inbound' })

    // Notifications are untouched: whatever the engine decides for this agency
    // with the rollout OFF, it decides identically with it ON. (The engine's own
    // product-access rule applies either way; this change does not touch it.)
    const off = await makeTenant('unpaid-off', { entitled: false })
    process.env.AGENT_RELIABILITY_AGENCY_IDS = ''
    await says(off, 'שלום, רציתי לשאול על מחירים')
    process.env.AGENT_RELIABILITY_AGENCY_IDS = 'all'
    const count = async (x: Tenant) =>
      Number((await db('notification_jobs').where({ agencyId: x.agencyId }).count<{ c: string }[]>('id as c'))[0].c)
    expect(await count(t)).toBe(await count(off))
  })

  it('a job queued before the rollout is skipped, not retried into the dead-letter queue (13)', async () => {
    const t = await makeTenant('unpaid-old', { entitled: false })
    process.env.AGENT_RELIABILITY_AGENCY_IDS = ''
    await says(t, 'שלום')
    process.env.AGENT_RELIABILITY_AGENCY_IDS = 'all'
    expect(await jobsFor(t)).toHaveLength(1)
    await drain()
    expect(modelCalls).toHaveLength(0)
    expect(sent).toHaveLength(0)
    const job = await lastJob(t)
    expect(job).toMatchObject({ status: 'skipped', skipReason: 'ai_not_entitled' })
  })

  it('acknowledge mode with an AI reply is paused too, with no model call', async () => {
    const t = await makeTenant('unpaid-ack', { entitled: false, mode: 'acknowledge', replyMode: 'ai' })
    await says(t, 'שלום')
    await drain()
    expect(ackCalls).toBe(0)
    expect(await jobsFor(t)).toHaveLength(0)
  })

  it('the owner signal is derived per agency, and adds no notification of its own (16)', async () => {
    const t = await makeTenant('unpaid-signal', { entitled: false })
    const settings = await db('auto_response_settings').where({ agencyId: t.agencyId }).first()
    expect(await aiRepliesPausedForPlan(t.agencyId, settings)).toBe(true)
    for (const body of ['שלום', 'יש מישהו?', 'הלו']) await says(t, body)
    await drain()
    // The pause itself emits nothing: whatever exists is the ordinary per-message
    // inbound notice the engine already decides, never a new alert type.
    const types: string[] = await db('notification_jobs').where({ agencyId: t.agencyId }).distinct('type').pluck('type')
    expect(types.every((x) => x === 'message.inbound')).toBe(true)
    expect(await jobsFor(t)).toHaveLength(0)

    const paid = await makeTenant('paid-signal', { entitled: true })
    const paidSettings = await db('auto_response_settings').where({ agencyId: paid.agencyId }).first()
    expect(await aiRepliesPausedForPlan(paid.agencyId, paidSettings)).toBe(false)
  })

  it('a questionnaire business is not paused: it never needs AI (17)', async () => {
    process.env.WA_QUESTIONNAIRE_ENABLED = '1'
    process.env.WA_QUESTIONNAIRE_AGENCY_IDS = 'all'
    const t = await makeTenant('unpaid-q', { entitled: false, responder: 'questionnaire' })
    const settings = await db('auto_response_settings').where({ agencyId: t.agencyId }).first()
    expect(await aiRepliesPausedForPlan(t.agencyId, settings)).toBe(false)
    await says(t, 'היי')
    const jobs = await jobsFor(t)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].reason).toBe('questionnaire_turn')
  })

  it('outside the rollout nothing changes: the job is still created', async () => {
    process.env.AGENT_RELIABILITY_AGENCY_IDS = ''
    const t = await makeTenant('unpaid-legacy', { entitled: false })
    await says(t, 'שלום')
    expect(await jobsFor(t)).toHaveLength(1)
  })
})

describe('a job created directly (not through ingest) for an unentitled agency', () => {
  it('is refused by the worker before any model call', async () => {
    const t = await makeTenant('direct', { entitled: false })
    await db('inbox_messages').insert({
      conversationId: t.conversationId,
      agencyId: t.agencyId,
      leadId: t.leadId,
      channel: 'whatsapp',
      direction: 'inbound',
      type: 'text',
      text: 'שלום',
      sequence: 1,
      externalId: `wamid.direct.${Math.random()}`,
    })
    await db.transaction((trx) =>
      enqueueAutoResponse(trx, {
        agencyId: t.agencyId,
        conversationId: t.conversationId,
        leadId: t.leadId,
        channel: 'whatsapp',
        triggerSequence: 1,
        reason: 'qualify_turn',
        delaySeconds: 0,
      }),
    )
    await drain()
    expect(modelCalls).toHaveLength(0)
    expect(await lastJob(t)).toMatchObject({ status: 'skipped', skipReason: 'ai_not_entitled' })
  })
})
