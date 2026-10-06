import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { findLatestOutbound, withConversationLock } from '@/lib/weddingRsvp/history'
import { isHeadCountAnswer } from '@/lib/weddingRsvp/headCount'
import { REPLY_ATTENDING, REPLY_THANKS, WEDDING_RSVP_SOURCE } from '@/lib/weddingRsvp/config'

/**
 * Real schema: the head-count decision as the webhook sees it, from rows in
 * inbox_messages, plus the per-conversation advisory lock.
 */

const PHONE_ID = '__wedding_pn'
const CUSTOMER = '972500000077'

let agencyId: number
let userId: number
let leadId: number
let conversationId: number

async function addMessage(
  direction: 'inbound' | 'outbound',
  text: string,
  opts: { source?: string; status?: string } = {},
): Promise<number> {
  const max = await db('inbox_messages').where({ conversationId }).max<{ max: string | null }>('sequence as max').first()
  const sequence = (Number(max?.max) || 0) + 1
  const [row] = await db('inbox_messages')
    .insert({
      conversationId,
      agencyId,
      leadId,
      channel: 'whatsapp',
      direction,
      externalId: `__wr_${direction}_${sequence}_${Date.now()}`,
      fromId: direction === 'inbound' ? CUSTOMER : PHONE_ID,
      toId: direction === 'inbound' ? PHONE_ID : CUSTOMER,
      type: 'text',
      text,
      payload: JSON.stringify({}),
      rawPayload: JSON.stringify({}),
      status: opts.status ?? (direction === 'inbound' ? 'received' : 'sent'),
      sentByUserId: null,
      sequence,
      metadata: JSON.stringify(opts.source ? { source: opts.source } : {}),
    })
    .returning('id')
  return Number(row.id)
}

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_wedding_rsvp__' }).returning('id')
  agencyId = Number(a.id)
  const [u] = await db('users').insert({ firstName: 'W', role: 'AGNT', agencyId }).returning('id')
  userId = Number(u.id)
  const [c] = await db('clients')
    .insert({ firstName: 'אורחת', lastName: 'בדיקה', phone: CUSTOMER, agencyId, userId, createdById: userId, status: 'new' })
    .returning('id')
  leadId = Number(c.id)
  const [conv] = await db('inbox_conversations')
    .insert({ agencyId, leadId, channel: 'whatsapp', businessPhoneNumberId: PHONE_ID, customerWaId: CUSTOMER, customerName: 'אורחת' })
    .returning('id')
  conversationId = Number(conv.id)
})

beforeEach(async () => {
  await db('inbox_messages').where({ conversationId }).del()
})

afterAll(async () => {
  await db('inbox_messages').where({ conversationId }).del()
  await db('inbox_conversations').where({ id: conversationId }).del()
  await db('clients').where({ id: leadId }).del()
  await db('users').where({ id: userId }).del()
  await db('agencies').where({ id: agencyId }).del()
})

describe('findLatestOutbound + isHeadCountAnswer on real rows', () => {
  it('a number right after the question is an answer; after the thank-you it is not', async () => {
    await addMessage('outbound', REPLY_ATTENDING, { source: WEDDING_RSVP_SOURCE })
    const four = await addMessage('inbound', '4')
    expect(isHeadCountAnswer(await findLatestOutbound(agencyId, conversationId), four, new Date())).toBe(true)

    await addMessage('outbound', REPLY_THANKS, { source: WEDDING_RSVP_SOURCE })
    const five = await addMessage('inbound', '5')
    expect(isHeadCountAnswer(await findLatestOutbound(agencyId, conversationId), five, new Date())).toBe(false)
  })

  it('guest chatter in between is fine; a person writing in between is not', async () => {
    await addMessage('outbound', REPLY_ATTENDING, { source: WEDDING_RSVP_SOURCE })
    await addMessage('inbound', '😂😂')
    const n1 = await addMessage('inbound', '3')
    expect(isHeadCountAnswer(await findLatestOutbound(agencyId, conversationId), n1, new Date())).toBe(true)

    await addMessage('outbound', 'כמה ילדים יש לך?', { source: 'smb_message_echo' })
    const n2 = await addMessage('inbound', '2')
    expect(isHeadCountAnswer(await findLatestOutbound(agencyId, conversationId), n2, new Date())).toBe(false)
  })

  it('ignores failed outbounds and other agencies', async () => {
    await addMessage('outbound', REPLY_ATTENDING, { source: WEDDING_RSVP_SOURCE })
    await addMessage('outbound', 'נכשלה', { status: 'failed' })
    const latest = await findLatestOutbound(agencyId, conversationId)
    expect(latest).toMatchObject({ text: REPLY_ATTENDING, source: WEDDING_RSVP_SOURCE })
    expect(await findLatestOutbound(agencyId + 100000, conversationId)).toBeNull()
  })
})

describe('withConversationLock', () => {
  it('serializes two callers on the same conversation', async () => {
    const order: string[] = []
    const slow = withConversationLock(conversationId, async () => {
      order.push('a-start')
      await new Promise((r) => setTimeout(r, 300))
      order.push('a-end')
    })
    await new Promise((r) => setTimeout(r, 50))
    const fast = withConversationLock(conversationId, async () => {
      order.push('b')
    })
    await Promise.all([slow, fast])
    expect(order).toEqual(['a-start', 'a-end', 'b'])
  })
})
