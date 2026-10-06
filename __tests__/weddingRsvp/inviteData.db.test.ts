import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { countInvitesSent, findConversationForWaId, listAgencyPhoneNumberIds, withInviteLock } from '@/lib/weddingRsvp/inviteData'
import { INVITE_BODY, INVITE_KIND, INVITE_STORED_TEXT } from '@/lib/weddingRsvp/config'

/** Real schema: duplicate detection across send paths, wa_id formats, and the lock. */

const PHONE_ID = '__wedding_invite_pn'
const GUEST = '972500000088'

let agencyId: number
let otherAgencyId: number
let userId: number
let conversationId: number

async function addOutbound(text: string, opts: { payload?: object; metadata?: object; status?: string; conv?: number } = {}) {
  const conv = opts.conv ?? conversationId
  const max = await db('inbox_messages').where({ conversationId: conv }).max<{ max: string | null }>('sequence as max').first()
  const sequence = (Number(max?.max) || 0) + 1
  await db('inbox_messages').insert({
    conversationId: conv,
    agencyId,
    leadId: null,
    channel: 'whatsapp',
    direction: 'outbound',
    externalId: `__wi_${conv}_${sequence}_${Date.now()}`,
    fromId: PHONE_ID,
    toId: GUEST,
    type: opts.payload ? 'image' : 'text',
    text,
    payload: JSON.stringify(opts.payload ?? {}),
    rawPayload: JSON.stringify({}),
    status: opts.status ?? 'sent',
    sentByUserId: null,
    sequence,
    metadata: JSON.stringify(opts.metadata ?? {}),
  })
}

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_wedding_invite__' }).returning('id')
  agencyId = Number(a.id)
  const [b] = await db('agencies').insert({ name: '__test_wedding_invite_other__' }).returning('id')
  otherAgencyId = Number(b.id)
  const [u] = await db('users').insert({ firstName: 'W', role: 'AGNT', agencyId }).returning('id')
  userId = Number(u.id)
  await db('whatsapp_connections').insert({ user_id: userId, agency_id: agencyId, phone_number_id: PHONE_ID, access_token: 'x' })
  // Stored in LOCAL format on purpose: lookups must normalize.
  const [conv] = await db('inbox_conversations')
    .insert({ agencyId, leadId: null, channel: 'whatsapp', businessPhoneNumberId: PHONE_ID, customerWaId: '0500000088', customerName: 'אורח' })
    .returning('id')
  conversationId = Number(conv.id)
})

beforeEach(async () => {
  await db('inbox_messages').where({ conversationId }).del()
})

afterAll(async () => {
  await db('inbox_messages').where({ conversationId }).del()
  await db('inbox_conversations').where({ id: conversationId }).del()
  await db('whatsapp_connections').where({ agency_id: agencyId }).del()
  await db('users').where({ id: userId }).del()
  await db('agencies').whereIn('id', [agencyId, otherAgencyId]).del()
})

describe('countInvitesSent', () => {
  it('zero for a guest who got nothing wedding-related', async () => {
    await addOutbound('שלום, מה שלומך?')
    expect(await countInvitesSent(agencyId, GUEST)).toBe(0)
  })

  it('counts an invite sent from the phone (echo image with the invite caption)', async () => {
    await addOutbound('', { payload: { id: 'm1', caption: INVITE_BODY }, metadata: { source: 'smb_message_echo' } })
    expect(await countInvitesSent(agencyId, GUEST)).toBe(1)
  })

  it('counts a template invite sent by this module', async () => {
    await addOutbound(INVITE_STORED_TEXT, { metadata: { kind: INVITE_KIND } })
    expect(await countInvitesSent(agencyId, GUEST)).toBe(1)
  })

  it('a delivered or read invite counts; failed ones alongside it do not add to the count', async () => {
    await addOutbound(INVITE_STORED_TEXT, { metadata: { kind: INVITE_KIND }, status: 'failed' })
    await addOutbound(INVITE_STORED_TEXT, { metadata: { kind: INVITE_KIND }, status: 'failed' })
    expect(await countInvitesSent(agencyId, GUEST)).toBe(0) // only failures → retry allowed
    await addOutbound(INVITE_STORED_TEXT, { metadata: { kind: INVITE_KIND }, status: 'delivered' })
    expect(await countInvitesSent(agencyId, GUEST)).toBe(1)
    await addOutbound(INVITE_STORED_TEXT, { metadata: { kind: INVITE_KIND }, status: 'read' })
    expect(await countInvitesSent(agencyId, GUEST)).toBe(2)
  })

  it('ignores a failed send, another number, and another agency', async () => {
    await addOutbound(INVITE_STORED_TEXT, { metadata: { kind: INVITE_KIND }, status: 'failed' })
    expect(await countInvitesSent(agencyId, GUEST)).toBe(0)
    await addOutbound(INVITE_STORED_TEXT, { metadata: { kind: INVITE_KIND } })
    expect(await countInvitesSent(agencyId, '972500000099')).toBe(0)
    expect(await countInvitesSent(otherAgencyId, GUEST)).toBe(0)
  })
})

describe('findConversationForWaId / listAgencyPhoneNumberIds', () => {
  it('finds a conversation stored in local format by its 972 wa_id, agency-scoped', async () => {
    expect(await findConversationForWaId(agencyId, GUEST)).toEqual({ id: conversationId, leadId: null, businessPhoneNumberId: PHONE_ID })
    expect(await findConversationForWaId(otherAgencyId, GUEST)).toBeNull()
    expect(await findConversationForWaId(agencyId, '972500000099')).toBeNull()
  })

  it('lists the agency connection', async () => {
    expect(await listAgencyPhoneNumberIds(agencyId)).toEqual([PHONE_ID])
    expect(await listAgencyPhoneNumberIds(otherAgencyId)).toEqual([])
  })
})

describe('withInviteLock', () => {
  it('serializes two callers for the same guest', async () => {
    const order: string[] = []
    const slow = withInviteLock(agencyId, GUEST, async () => {
      order.push('a-start')
      await new Promise((r) => setTimeout(r, 300))
      order.push('a-end')
    })
    await new Promise((r) => setTimeout(r, 50))
    const fast = withInviteLock(agencyId, GUEST, async () => {
      order.push('b')
    })
    await Promise.all([slow, fast])
    expect(order).toEqual(['a-start', 'a-end', 'b'])
  })
})
