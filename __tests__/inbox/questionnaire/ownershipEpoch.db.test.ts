import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { ingestWhatsappEchoes } from '@/lib/inbox/ingestWhatsappEcho'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { runQuestionnaireWorker } from '@/lib/inbox/autoresponse/questionnaire/worker'
import {
  markHumanActiveByConversation,
  returnConversationToAgent,
  takeOverConversationByRep,
} from '@/db/conversationHumanPresence'
import { humanTookOverSinceEpoch } from '@/lib/inbox/autoresponse/reliability/ownership'
import type { SendWhatsappTextResult } from '@/lib/whatsapp/sendMessage'

/**
 * Questionnaire ownership, on the AI agent's rule (AGENT_RELIABILITY_AGENCY_IDS):
 * only a PERSON's outbound takes the conversation, and only one after the last
 * return-to-agent. Real database, real ingest (inbound and Coexistence echoes),
 * real ownership actions, real questionnaire worker; only WhatsApp is faked.
 */

const DEF = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'scripts/questionnaire/samples/event-photography.he.json'), 'utf8'),
)

let sent: string[] = []
const send = (async (args: { to: string; body: string }): Promise<SendWhatsappTextResult> => {
  sent.push(args.body)
  return { ok: true, wamid: `wamid.out.${Math.random().toString(36).slice(2)}` }
}) as never

const agencies: number[] = []
type Tenant = { agencyId: number; userId: number; leadId: number; conversationId: number; phoneNumberId: string; customerWaId: string }

async function makeTenant(suffix: string): Promise<Tenant> {
  const [a] = await db('agencies').insert({ name: `q-own-${suffix}`, autoResponseEnabled: true, plan: 'pro' }).returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [u] = await db('users').insert({ firstName: 'נ', role: 'AGNT', agencyId }).returning('id')
  const userId = Number(u.id)
  const phoneNumberId = `q_own_pn_${suffix}`
  const customerWaId = `97253${String(agencyId).padStart(7, '0')}`
  await db('whatsapp_connections').insert({ user_id: userId, agency_id: agencyId, phone_number_id: phoneNumberId, access_token: 'test-token' })
  await db('auto_response_settings').insert({
    agencyId,
    channel: 'whatsapp',
    enabled: true,
    mode: 'acknowledge',
    responder: 'questionnaire',
    questionnaire: JSON.stringify(DEF),
    updatedBy: userId,
  })
  const [c] = await db('clients')
    .insert({ firstName: 'פונה', lastName: 'חדש', phone: customerWaId, agencyId, userId, handlerId: userId, createdById: userId, status: 'new' })
    .returning('id')
  const leadId = Number(c.id)
  const [conv] = await db('inbox_conversations')
    .insert({ agencyId, leadId, channel: 'whatsapp', businessPhoneNumberId: phoneNumberId, customerWaId })
    .returning('id')
  return { agencyId, userId, leadId, conversationId: Number(conv.id), phoneNumberId, customerWaId }
}

/** Exactly what the webhook does with one customer message. */
const customerSays = (t: Tenant, body: string) =>
  ingestWhatsappInbound({
    agencyId: t.agencyId,
    leadId: t.leadId,
    businessPhoneNumberId: t.phoneNumberId,
    customerWaId: t.customerWaId,
    customerName: 'פונה חדש',
    rawMessage: { id: `wamid.in.${Math.random().toString(36).slice(2)}`, from: t.customerWaId, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } },
  })

/** The owner answering from the WhatsApp Business app (Coexistence), through the real echo ingest. */
const ownerRepliesFromPhone = (t: Tenant, body: string) =>
  ingestWhatsappEchoes({
    metadata: { phone_number_id: t.phoneNumberId },
    message_echoes: [
      { id: `wamid.echo.${Math.random().toString(36).slice(2)}`, from: '972500000000', to: t.customerWaId, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } },
    ],
  })

/** A persisted outbound as SocialCRM stores it: a rep's reply (user, no source) or an automation template (neither). */
const outbound = (t: Tenant, text: string, sentByUserId: number | null) =>
  persistOutboundWhatsapp({
    agencyId: t.agencyId,
    leadId: t.leadId,
    businessPhoneNumberId: t.phoneNumberId,
    customerWaId: t.customerWaId,
    customerName: 'פונה חדש',
    sentByUserId,
    wamid: `wamid.o.${Math.random().toString(36).slice(2)}`,
    text,
  })
const repReplies = (t: Tenant, text: string) => outbound(t, text, t.userId)
const automationSends = (t: Tenant, text: string) => outbound(t, text, null)

const drain = () => runQuestionnaireWorker({ deps: { send }, workerId: `test-${Math.random()}` })
const session = (t: Tenant) => db('questionnaire_sessions').where({ conversationId: t.conversationId }).orderBy('id', 'desc').first()
const lastOutbound = (t: Tenant) =>
  db('inbox_messages').where({ conversationId: t.conversationId, direction: 'outbound' }).orderBy('sequence', 'desc').first('id', 'sequence')
const lastJob = (t: Tenant) => db('auto_response_jobs').where({ conversationId: t.conversationId }).orderBy('id', 'desc').first()

/** A live questionnaire, waiting on the event-type question. */
async function midQuestionnaire(t: Tenant) {
  await customerSays(t, 'שלום')
  await drain()
  await customerSays(t, '1')
  await drain()
  expect(sent.at(-1)).toContain('מה סוג האירוע?')
  sent = []
}

/** The rep hands the conversation back, the way the inbox does. */
async function takeOverThenReturn(t: Tenant) {
  await takeOverConversationByRep({ conversationId: t.conversationId, agencyId: t.agencyId })
  expect(await returnConversationToAgent({ conversationId: t.conversationId, agencyId: t.agencyId })).toBe(true)
}

/** The questionnaire asked its next question: it kept the conversation. */
async function expectContinued(t: Tenant) {
  expect(sent).toHaveLength(1)
  expect(sent[0]).toContain('איזה כיסוי')
  expect((await session(t))?.status).toBe('active')
}

/** The questionnaire stood down silently: a person owns the conversation. */
async function expectYielded(t: Tenant) {
  expect(sent, 'the questionnaire must not speak over a person').toHaveLength(0)
  const s = await session(t)
  expect(s?.status).toBe('human_took_over')
  expect(s?.answers).toMatchObject({ services: ['stills'] })
}

let saved: string | undefined
beforeAll(() => {
  saved = process.env.AGENT_RELIABILITY_AGENCY_IDS
  process.env.WA_QUESTIONNAIRE_ENABLED = '1'
  process.env.WA_QUESTIONNAIRE_AGENCY_IDS = 'all'
})
beforeEach(() => {
  sent = []
  process.env.AGENT_RELIABILITY_AGENCY_IDS = 'all'
})
afterAll(async () => {
  if (saved === undefined) delete process.env.AGENT_RELIABILITY_AGENCY_IDS
  else process.env.AGENT_RELIABILITY_AGENCY_IDS = saved
  delete process.env.WA_QUESTIONNAIRE_ENABLED
  delete process.env.WA_QUESTIONNAIRE_AGENCY_IDS
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

describe('what counts as a person taking over the questionnaire', () => {
  it('a rep reply from SocialCRM pauses it (1)', async () => {
    const t = await makeTenant('rep')
    await midQuestionnaire(t)
    await repReplies(t, 'היי, כאן נועה מהסטודיו')
    await customerSays(t, '1')
    await drain()
    await expectYielded(t)
  })

  it('a reply from the WhatsApp Business app (Coexistence echo) pauses it (2)', async () => {
    const t = await makeTenant('echo')
    await midQuestionnaire(t)
    await ownerRepliesFromPhone(t, 'אני אחזור אלייך עוד שעה')
    await customerSays(t, '1')
    await drain()
    await expectYielded(t)
  })

  it('its own questions are never a takeover, through a whole conversation (3)', async () => {
    const t = await makeTenant('own')
    for (const answer of ['שלום', '1,2', '1', '1', '14 ביוני 2027', 'בערך 300', 'חיפה']) {
      await customerSays(t, answer)
      await drain()
    }
    expect(sent.at(-1)).toContain('קיבלנו את הפרטים')
    expect((await session(t))?.status).toBe('completed')
    // Every one of those rows carries the lead owner's user id; the source is what rules it out.
    const own = await db('inbox_messages').where({ conversationId: t.conversationId, direction: 'outbound' }).select('sentByUserId', 'metadata')
    expect(own.length).toBe(7)
    expect(own.every((m) => m.sentByUserId != null && m.metadata?.source === 'auto_response')).toBe(true)
  })

  it('an automation template is not a takeover (4)', async () => {
    const t = await makeTenant('auto')
    await midQuestionnaire(t)
    await automationSends(t, 'תזכורת: הפגישה שלך מחר')
    await customerSays(t, '1')
    await drain()
    await expectContinued(t)
  })

  it('a rep send that failed is not a takeover', async () => {
    const t = await makeTenant('failed')
    await midQuestionnaire(t)
    await repReplies(t, 'היי, כאן נועה')
    await db('inbox_messages').where({ id: (await lastOutbound(t)).id }).update({ status: 'failed' })
    await customerSays(t, '1')
    await drain()
    await expectContinued(t)
  })
})

describe('return to agent, and the ownership epoch', () => {
  it('after Return to Agent the next customer message resumes the questionnaire (5, 6)', async () => {
    const t = await makeTenant('return')
    await midQuestionnaire(t)
    await repReplies(t, 'היי, כאן נועה')
    await ownerRepliesFromPhone(t, 'ואני מהטלפון')
    const lastHuman = Number((await lastOutbound(t)).sequence)
    await takeOverThenReturn(t)
    const q = (await db('conversation_ai_state').where({ conversationId: t.conversationId }).first('qualification')).qualification
    expect(q.ownership.sinceSequence).toBeGreaterThanOrEqual(lastHuman)

    await customerSays(t, '1')
    await drain()
    await expectContinued(t)
    expect((await lastJob(t))?.status).toBe('sent')
  })

  it('a NEW human reply after the return pauses it again (7)', async () => {
    const t = await makeTenant('retake')
    await midQuestionnaire(t)
    await repReplies(t, 'היי, כאן נועה')
    await takeOverThenReturn(t)
    await ownerRepliesFromPhone(t, 'אני כאן שוב')
    await customerSays(t, '1')
    await drain()
    await expectYielded(t)
  })

  it('a rep marked active synchronously (before the send is persisted) still wins over the epoch', async () => {
    const t = await makeTenant('sync')
    await midQuestionnaire(t)
    await repReplies(t, 'היי, כאן נועה')
    await takeOverThenReturn(t)
    await markHumanActiveByConversation(t.conversationId, t.agencyId)
    await customerSays(t, '1')
    await drain()
    await expectYielded(t)
  })

  it('sequence decides, not time: an old reply with a LATER timestamp stays behind the epoch (8)', async () => {
    const t = await makeTenant('seq-old')
    await midQuestionnaire(t)
    await repReplies(t, 'היי, כאן נועה')
    const future = new Date(Date.now() + 24 * 3600_000)
    await db('inbox_messages').where({ id: (await lastOutbound(t)).id }).update({ createdAt: future, channelTimestamp: future })
    await takeOverThenReturn(t)
    await customerSays(t, '1')
    await drain()
    await expectContinued(t)
  })

  it('sequence decides, not time: a new reply with an EARLIER timestamp still takes over (8)', async () => {
    const t = await makeTenant('seq-new')
    await midQuestionnaire(t)
    await repReplies(t, 'היי, כאן נועה')
    await takeOverThenReturn(t)
    await ownerRepliesFromPhone(t, 'אני כאן שוב')
    const past = new Date('2020-01-01T00:00:00Z')
    await db('inbox_messages').where({ id: (await lastOutbound(t)).id }).update({ createdAt: past, channelTimestamp: past })
    await customerSays(t, '1')
    await drain()
    await expectYielded(t)
  })

  it('a person’s reply of unknown position counts as a takeover (9)', () => {
    // Every persisted row has a sequence, so this is the rule the worker uses, on
    // questionnaire-shaped rows: when position is unknown, the person wins.
    const questionnaireTurn = { direction: 'outbound', sentByUserId: 7, metadata: { source: 'auto_response', kind: 'questionnaire' }, sequence: 2 }
    expect(humanTookOverSinceEpoch([questionnaireTurn], 0)).toBe(false)
    expect(humanTookOverSinceEpoch([{ direction: 'outbound', sentByUserId: 7, metadata: null, sequence: null }], 50)).toBe(true)
    expect(humanTookOverSinceEpoch([{ direction: 'outbound', sentByUserId: null, metadata: { source: 'smb_message_echo' } }], 50)).toBe(true)
  })
})

describe('agencies outside the reliability rollout (14)', () => {
  it('keep the questionnaire’s previous rule: an old rep reply still pauses it after Return to Agent', async () => {
    const t = await makeTenant('legacy')
    process.env.AGENT_RELIABILITY_AGENCY_IDS = ''
    await midQuestionnaire(t)
    await repReplies(t, 'היי, כאן נועה')
    await takeOverThenReturn(t)
    await customerSays(t, '1')
    await drain()
    await expectYielded(t)
  })

  it('keep the questionnaire’s previous rule: a failed rep send still counts', async () => {
    const t = await makeTenant('legacy-failed')
    process.env.AGENT_RELIABILITY_AGENCY_IDS = ''
    await midQuestionnaire(t)
    await repReplies(t, 'היי, כאן נועה')
    await db('inbox_messages').where({ id: (await lastOutbound(t)).id }).update({ status: 'failed' })
    await customerSays(t, '1')
    await drain()
    await expectYielded(t)
  })
})
