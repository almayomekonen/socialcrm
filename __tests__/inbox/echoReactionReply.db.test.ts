import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ agencyId: 0 }))
vi.mock('@/db/auth', () => ({ getUser: async () => ({ id: 1, agencyId: auth.agencyId }) }))

import { db } from '@/config/db'
import { ingestWhatsappEchoes } from '@/lib/inbox/ingestWhatsappEcho'
import { listConversationMessages } from '@/db/inboxMessages'

/**
 * Coexistence echoes, against a real PostgreSQL: what the owner does in the
 * WhatsApp Business app (react, quote-reply) arrives through the real ingest
 * and reaches the thread. Before, a reaction echo was stored with an empty
 * payload (emoji and target lost) and a quote-reply kept no reference.
 */

const PN = '__echo_refs_pn'
const CUSTOMER = '972500000077'
let agencyId: number
let conversationId: number

const echoValue = (echoes: Array<Record<string, unknown>>) => ({
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: '972300000000', phone_number_id: PN },
  message_echoes: echoes.map((e) => ({ from: '972300000000', to: CUSTOMER, timestamp: '1760000000', ...e })),
})

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_echo_refs__' }).returning('id')
  agencyId = Number(a.id)
  auth.agencyId = agencyId
  const [u] = await db('users').insert({ firstName: 'E', role: 'AGNT', agencyId }).returning('id')
  await db('whatsapp_connections').insert({ user_id: u.id, agency_id: agencyId, phone_number_id: PN, access_token: 'x' })

  // The customer's message, then the owner's reaction to it and quote-reply to it, from the phone.
  await ingestWhatsappEchoes(echoValue([{ id: 'wamid.__echo_first', type: 'text', text: { body: 'הודעה ראשונה' } }]))
  const conv = await db('inbox_conversations').where({ agencyId, businessPhoneNumberId: PN }).first('id')
  conversationId = Number(conv.id)
  await db('inbox_messages').insert({
    conversationId, agencyId, channel: 'whatsapp', direction: 'inbound', externalId: 'wamid.__echo_customer',
    type: 'text', text: 'שאלה של לקוח', payload: '{}', status: 'received', sequence: 100, metadata: '{}',
  })
  await ingestWhatsappEchoes(
    echoValue([
      { id: 'wamid.__echo_react', type: 'reaction', reaction: { message_id: 'wamid.__echo_customer', emoji: '👍' } },
      { id: 'wamid.__echo_reply', type: 'text', text: { body: 'תשובה' }, context: { from: CUSTOMER, id: 'wamid.__echo_customer' } },
      { id: 'wamid.__echo_fwd', type: 'text', text: { body: 'הועבר' }, context: { forwarded: true } },
    ]),
  )
})

afterAll(async () => {
  await db('inbox_messages').where({ agencyId }).del()
  await db('inbox_participants').where({ agencyId }).del()
  await db('inbox_conversations').where({ agencyId }).del()
  await db('whatsapp_connections').where({ agency_id: agencyId }).del()
  await db('users').where({ agencyId }).del()
  await db('agencies').where({ id: agencyId }).del()
})

const row = (externalId: string) => db('inbox_messages').where({ channel: 'whatsapp', externalId }).first('id', 'type', 'payload', 'metadata')

describe('stored', () => {
  it('a reaction echo keeps { message_id, emoji }', async () => {
    const r = await row('wamid.__echo_react')
    expect(r.type).toBe('reaction')
    expect(r.payload).toEqual({ message_id: 'wamid.__echo_customer', emoji: '👍' })
  })

  it('a quote-reply echo keeps the quoted id in metadata.replyTo, next to its source', async () => {
    const r = await row('wamid.__echo_reply')
    expect(r.metadata).toMatchObject({ source: 'smb_message_echo', replyTo: { id: 'wamid.__echo_customer' } })
  })

  it('a forwarded marker or a plain echo gets no replyTo; a text echo payload is still empty', async () => {
    for (const id of ['wamid.__echo_fwd', 'wamid.__echo_first']) {
      const r = await row(id)
      expect(r.metadata.replyTo).toBeUndefined()
      expect(r.payload).toEqual({})
    }
  })

  it('a redelivery changes nothing', async () => {
    const before = await db('inbox_messages').where({ agencyId }).orderBy('id').select('id', 'payload', 'metadata')
    const result = await ingestWhatsappEchoes(
      echoValue([{ id: 'wamid.__echo_react', type: 'reaction', reaction: { message_id: 'wamid.__echo_customer', emoji: '❤️' } }]),
    )
    expect(result.duplicates).toBe(1)
    expect(await db('inbox_messages').where({ agencyId }).orderBy('id').select('id', 'payload', 'metadata')).toEqual(before)
  })
})

describe('shown in the thread', () => {
  it("the owner's reaction and quote-reply resolve to the customer's message", async () => {
    const list = await listConversationMessages(conversationId)
    const customer = (await row('wamid.__echo_customer')).id
    const react = list.find((m) => m.type === 'reaction')
    expect(react?.reaction).toEqual({ emoji: '👍', targetId: Number(customer) })
    const reply = list.find((m) => m.text === 'תשובה')
    expect(reply?.replyTo).toEqual({ targetId: Number(customer) })
  })
})
