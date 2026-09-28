/**
 * A human reply resolves "waiting for a person" notifications — through the
 * real write paths, against Postgres.
 *
 *   SocialCRM reply           persistOutboundWhatsapp (user, no source) → cleared
 *   WhatsApp Business app     ingestWhatsappEchoes (smb_message_echoes)   → cleared
 *   AI / questionnaire send   persistOutboundWhatsapp (auto_response)     → NOT cleared
 *   Automation template       persistOutboundWhatsapp (no user, no source) → NOT cleared
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { persistOutboundWhatsapp } from '@/lib/inbox/persistOutboundWhatsapp'
import { ingestWhatsappEchoes } from '@/lib/inbox/ingestWhatsappEcho'

const PHONE_ID = `__attn_pn_${process.pid}`
const CUSTOMER = '972500009911'
let agencyId: number
let userId: number
let leadId: number
let conversationId: number
let seq = 0

async function unreadKeys(): Promise<string[]> {
  return db('notifications').where({ agencyId }).whereNull('readAt').orderBy('collapseKey').pluck('collapseKey')
}

async function seedNotifications() {
  await db('notifications').where({ agencyId }).del()
  const base = { agencyId, userId, category: 'messages', priority: 'high', title: 't', deepLink: '/inbox' }
  await db('notifications').insert([
    { ...base, type: 'message.unanswered', collapseKey: `conversation:${conversationId}:unanswered` },
    { ...base, type: 'lead.handoff', category: 'leads', collapseKey: `conversation:${conversationId}:handoff` },
    { ...base, type: 'message.inbound', collapseKey: `conversation:${conversationId}:inbound` },
  ])
}

const send = (over: { sentByUserId: number | null; metadata?: Record<string, unknown> }) =>
  persistOutboundWhatsapp({
    agencyId,
    leadId,
    businessPhoneNumberId: PHONE_ID,
    customerWaId: CUSTOMER,
    customerName: 'דנה לוי',
    wamid: `wamid.__attn_${process.pid}_${seq++}`,
    text: 'תשובה',
    ...over,
  })

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__attention_db_test' }).returning('id')
  agencyId = Number(a.id)
  const [u] = await db('users').insert({ firstName: 'Rep', role: 'ADMIN', agencyId }).returning('id')
  userId = Number(u.id)
  const [c] = await db('clients')
    .insert({ firstName: 'דנה', lastName: 'לוי', phone: CUSTOMER, agencyId, userId, createdById: userId, status: 'new' })
    .returning('id')
  leadId = Number(c.id)
  await db('whatsapp_connections').insert({ user_id: userId, agency_id: agencyId, phone_number_id: PHONE_ID, access_token: 'x' })
  // The conversation the writes resolve to.
  conversationId = (await send({ sentByUserId: null, metadata: { source: 'auto_response' } })).conversationId
})

beforeEach(seedNotifications)

afterAll(async () => {
  await db('notifications').where({ agencyId }).del()
  await db('conversation_analysis_jobs').where({ agencyId }).del()
  await db('inbox_messages').where({ agencyId }).del()
  await db('inbox_participants').where({ agencyId }).del()
  await db('inbox_conversations').where({ agencyId }).del()
  await db('whatsapp_connections').where({ agency_id: agencyId }).del()
  await db('clients').where({ agencyId }).del()
  await db('users').where({ agencyId }).del()
  await db('agencies').where({ id: agencyId }).del()
  await db.destroy()
})

const WAITING = () => [`conversation:${conversationId}:handoff`, `conversation:${conversationId}:unanswered`]
const INBOUND = () => `conversation:${conversationId}:inbound`

describe('what resolves "waiting for a person"', () => {
  it('a reply sent from SocialCRM', async () => {
    await send({ sentByUserId: userId })
    expect(await unreadKeys()).toEqual([INBOUND()])
  })

  it('a reply sent from the WhatsApp Business app (Coexistence echo)', async () => {
    const result = await ingestWhatsappEchoes({
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '972500000000', phone_number_id: PHONE_ID },
      message_echoes: [
        {
          from: '972500000000',
          to: CUSTOMER,
          id: `wamid.__attn_echo_${process.pid}_${seq++}`,
          timestamp: String(Math.floor(Date.now() / 1000)),
          type: 'text',
          text: { body: 'עונה מהטלפון' },
        },
      ],
    })
    expect(result.persisted).toBe(1)
    expect(await unreadKeys()).toEqual([INBOUND()])
  })

  it('NOT an AI or questionnaire message', async () => {
    await send({ sentByUserId: userId, metadata: { source: 'auto_response', kind: 'questionnaire' } })
    expect(await unreadKeys()).toEqual([...WAITING(), INBOUND()].sort())
  })

  it('NOT an automation template send', async () => {
    await send({ sentByUserId: null })
    expect(await unreadKeys()).toEqual([...WAITING(), INBOUND()].sort())
  })
})
