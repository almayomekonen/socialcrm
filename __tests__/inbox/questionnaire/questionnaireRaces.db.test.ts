import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/config/db'
import { ingestWhatsappInbound } from '@/lib/inbox/ingestWhatsappInbound'
import { ingestWhatsappEchoes } from '@/lib/inbox/ingestWhatsappEcho'
import { runQuestionnaireWorker } from '@/lib/inbox/autoresponse/questionnaire/worker'
import { markHumanActiveByConversation } from '@/db/conversationHumanPresence'
import { getHandoffSummary } from '@/db/conversationIntelligence'
import type { SendWhatsappTextResult } from '@/lib/whatsapp/sendMessage'

/**
 * Races and repeats against a real database: duplicate webhook deliveries, a
 * customer writing while a turn runs, the owner answering from the WhatsApp
 * Business app in the instant between "decided" and "sent", captions.
 *
 * The harness is perfectPicture.db.test.ts's. The one seam: the turn's
 * service-window read, which runs after the decision and before any send, gets
 * an optional hook so a test can land an event in exactly that window.
 */
const race = vi.hoisted(() => ({ hook: null as null | (() => Promise<void>) }))
vi.mock('@/lib/inbox/whatsappComposerContext', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/inbox/whatsappComposerContext')>()
  return {
    ...original,
    queryLatestInboundAt: async (...args: Parameters<typeof original.queryLatestInboundAt>) => {
      const hook = race.hook
      race.hook = null
      if (hook) await hook()
      return original.queryLatestInboundAt(...args)
    },
  }
})

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
    .insert({ name: `q-race-${suffix}`, autoResponseEnabled: true, plan: 'pro' })
    .returning('id')
  const agencyId = Number(a.id)
  agencies.push(agencyId)
  const [u] = await db('users').insert({ firstName: 'נ', role: 'AGNT', agencyId }).returning('id')
  const userId = Number(u.id)
  const phoneNumberId = `q_race_pn_${suffix}`
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



/** One webhook delivery with a fixed WhatsApp message id, so it can be delivered twice. */
async function deliver(t: Tenant, body: string, id: string, extra: Record<string, unknown> = { type: 'text', text: { body } }): Promise<void> {
  await ingestWhatsappInbound({
    agencyId: t.agencyId,
    leadId: t.leadId,
    businessPhoneNumberId: t.phoneNumberId,
    customerWaId: t.customerWaId,
    customerName: 'פונה חדש',
    rawMessage: { id, from: t.customerWaId, timestamp: String(Math.floor(Date.now() / 1000)), ...extra },
  })
}

const ownerRepliesFromPhone = (t: Tenant, body: string) =>
  ingestWhatsappEchoes({
    metadata: { phone_number_id: t.phoneNumberId },
    message_echoes: [
      { id: `wamid.echo.${Math.random().toString(36).slice(2)}`, from: '972500000000', to: t.customerWaId, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } },
    ],
  })

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await drain()
}

const outboundCount = async (t: Tenant) =>
  Number((await db('inbox_messages').where({ conversationId: t.conversationId, direction: 'outbound' }).count<{ c: string }[]>('id as c'))[0].c)

describe('duplicate webhook deliveries', () => {
  it('every state transitions once: start, choice, free text, invalid, completion', async () => {
    const t = await makeTenant('dup')
    const twice = async (body: string, id: string) => {
      await deliver(t, body, id)
      await deliver(t, body, id)
      await settle()
    }
    await twice('היי', 'wamid.dup.1')
    expect(await outboundCount(t)).toBe(1)
    await twice('חתונה', 'wamid.dup.2')
    expect(await outboundCount(t)).toBe(2)
    await twice('לתאריך', 'wamid.dup.3')
    expect(await outboundCount(t)).toBe(3)
    expect((await sessionRow(t))?.invalidCount).toBe(1)
    await twice('18.11', 'wamid.dup.4')
    await twice('רחובות', 'wamid.dup.5')
    await twice('סטילס', 'wamid.dup.6')
    expect(await outboundCount(t)).toBe(6)

    const inbound = await db('inbox_messages').where({ conversationId: t.conversationId, direction: 'inbound' }).count<{ c: string }[]>('id as c')
    expect(Number(inbound[0].c)).toBe(6)
    const session = await sessionRow(t)
    expect(session?.status).toBe('completed')
    expect(session?.answers).toEqual({ event_type: ['wedding'], event_date_celebration: ['18.11'], event_location: ['רחובות'], service: ['stills'] })
    const closings = sent.filter((m) => m.body.includes('קיבלנו את הפרטים'))
    expect(closings).toHaveLength(1)
    const notifications = await db('notification_jobs').where({ agencyId: t.agencyId, type: 'lead.questionnaire_handoff' }).count<{ c: string }[]>('id as c')
    expect(Number(notifications[0].c)).toBe(1)
    const task = await db('tasks').where({ clientId: t.leadId }).orderBy('id', 'desc').first('notes')
    const notes = (typeof task?.notes === 'string' ? JSON.parse(task.notes) : task?.notes) as unknown[]
    expect(notes.filter((n) => JSON.stringify(n).includes('שאלון וואטסאפ הושלם'))).toHaveLength(1)
  })
})

describe('the customer writes while a turn is running', () => {
  it('the message is not lost: a follow-up turn answers it, against the right question', async () => {
    const t = await makeTenant('gap')
    await customerSays(t, 'היי')
    await settle()
    await customerSays(t, 'חתונה')
    await settle()
    await customerSays(t, '18.11')
    // While the location question is being sent, the customer already answers it.
    sendImpl = async () => {
      sendImpl = okSend
      await customerSays(t, 'רחובות')
      return okSend()
    }
    await settle()
    const session = await sessionRow(t)
    expect(session?.currentStepId).toBe('service')
    expect(session?.answers).toMatchObject({ event_date_celebration: ['18.11'], event_location: ['רחובות'] })
    expect(sent.map((m) => m.body).filter((b) => b.includes('איזה שירות צילום'))).toHaveLength(1)
  })
})

describe('the owner answers from their phone while a turn is running', () => {
  it('before a question: the question is not sent, and the questionnaire yields', async () => {
    const t = await makeTenant('echo-q')
    await customerSays(t, 'היי')
    await settle()
    await customerSays(t, 'חתונה')
    race.hook = async () => {
      await ownerRepliesFromPhone(t, 'היי, אני כאן, מתי החתונה?')
    }
    const before = sent.length
    await settle()
    expect(sent.length).toBe(before)
    await customerSays(t, '18.11')
    await settle()
    expect(sent.length).toBe(before)
    expect((await sessionRow(t))?.status).toBe('human_took_over')
  })

  it('before the closing: the answers are saved, the goodbye is not sent', async () => {
    const t = await makeTenant('echo-close')
    for (const m of ['היי', 'חתונה', '18.11', 'רחובות']) {
      await customerSays(t, m)
      await settle()
    }
    await customerSays(t, 'סטילס')
    race.hook = async () => {
      await ownerRepliesFromPhone(t, 'מעולה, אני חוזר אליכם עכשיו')
    }
    const before = sent.length
    await settle()
    expect(sent.length).toBe(before)
    const session = await sessionRow(t)
    expect(session?.status).toBe('completed')
    expect(session?.answers).toMatchObject({ service: ['stills'] })
  })
})

describe('captions and bursts through the real ingest', () => {
  it('an image captioned "18.11" answers the date question', async () => {
    const t = await makeTenant('caption')
    await customerSays(t, 'היי')
    await settle()
    await customerSays(t, 'חתונה')
    await settle()
    await deliver(t, '', 'wamid.cap.1', { type: 'image', image: { id: 'media-1', caption: '18.11' } })
    await settle()
    const session = await sessionRow(t)
    expect(session?.currentStepId).toBe('event_location')
    expect(session?.answers.event_date_celebration).toEqual(['18.11'])
  })

  it('three messages before any reply: one question back, only the open question answered', async () => {
    const t = await makeTenant('burst')
    await customerSays(t, 'היי')
    await settle()
    const before = sent.length
    await customerSays(t, 'חתונה')
    await customerSays(t, '18.11')
    await customerSays(t, 'רחובות')
    await settle()
    expect(sent.length - before).toBe(1)
    const session = await sessionRow(t)
    expect(session?.currentStepId).toBe('event_date_celebration')
    expect(session?.answers).toEqual({ event_type: ['wedding'] })
  })
})
