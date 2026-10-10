import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ agencyId: 0 }))
vi.mock('@/db/auth', () => ({ getUser: async () => ({ id: 1, agencyId: auth.agencyId }) }))

import { db } from '@/config/db'
import { getConversationMessagesAfter, listConversationMessages, type LeadWhatsappMessage } from '@/db/inboxMessages'

/**
 * Reaction and reply targets, resolved by the real thread readers against a
 * real PostgreSQL: exact external id, same channel, SAME CONVERSATION only.
 */

let agencyId: number
let convA: number
let convB: number
const ids: Record<string, number> = {}

async function insert(key: string, conversationId: number, row: Record<string, unknown>) {
  const [r] = await db('inbox_messages')
    .insert({
      conversationId,
      agencyId,
      channel: 'whatsapp',
      direction: 'inbound',
      type: 'text',
      text: '',
      status: 'received',
      sequence: Object.keys(ids).length + 1,
      ...row,
      payload: JSON.stringify(row.payload ?? {}),
      rawPayload: JSON.stringify(row.rawPayload ?? null),
      metadata: JSON.stringify(row.metadata ?? {}),
    })
    .returning('id')
  ids[key] = Number(r.id)
}

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_thread_refs__' }).returning('id')
  agencyId = Number(a.id)
  auth.agencyId = agencyId
  const conv = (wa: string) =>
    db('inbox_conversations').insert({ agencyId, channel: 'whatsapp', businessPhoneNumberId: '__refs_pn', customerWaId: wa }).returning('id')
  convA = Number((await conv('972500000001'))[0].id)
  convB = Number((await conv('972500000002'))[0].id)

  await insert('t1', convA, { externalId: 'wamid.__refs_T1', text: 'הודעה' })
  await insert('otherConv', convB, { externalId: 'wamid.__refs_B1', text: 'בשיחה אחרת' })
  await insert('react', convA, { externalId: 'wamid.__refs_R1', type: 'reaction', payload: { message_id: 'wamid.__refs_T1', emoji: '👍' } })
  await insert('removed', convA, { externalId: 'wamid.__refs_R2', type: 'reaction', payload: { message_id: 'wamid.__refs_T1' } })
  await insert('reactMissing', convA, { externalId: 'wamid.__refs_R3', type: 'reaction', payload: { message_id: 'wamid.__refs_NOPE', emoji: '❤️' } })
  await insert('reactCross', convA, { externalId: 'wamid.__refs_R4', type: 'reaction', payload: { message_id: 'wamid.__refs_B1', emoji: '😂' } })
  await insert('reply', convA, { externalId: 'wamid.__refs_Q1', text: 'כן', rawPayload: { context: { from: '972500000001', id: 'wamid.__refs_T1' } } })
  await insert('replyMissing', convA, { externalId: 'wamid.__refs_Q2', text: 'כן', rawPayload: { context: { from: '972500000001', id: 'wamid.__refs_OLD' } } })
  await insert('forwarded', convA, { externalId: 'wamid.__refs_F1', text: 'הועבר', rawPayload: { context: { forwarded: true } } })
  await insert('echoReply', convA, {
    externalId: 'wamid.__refs_E1',
    direction: 'outbound',
    status: 'sent',
    text: 'תשובה מהטלפון',
    metadata: { source: 'smb_message_echo', replyTo: { id: 'wamid.__refs_T1' } },
  })
  await insert('captioned', convA, { externalId: 'wamid.__refs_I1', type: 'image', payload: { id: 'media__refs', mime_type: 'image/jpeg', caption: 'מחירון' } })
})

afterAll(async () => {
  await db('inbox_messages').where({ agencyId }).del()
  await db('inbox_conversations').where({ agencyId }).del()
  await db('agencies').where({ id: agencyId }).del()
})

const byId = (list: LeadWhatsappMessage[]) => new Map(list.map((m) => [m.id, m]))

for (const [name, read] of [
  ['the sync delta', () => getConversationMessagesAfter(convA, 0, agencyId)],
  ['the full thread', () => listConversationMessages(convA)],
] as const) {
  describe(name, () => {
    it('resolves a reaction to its target in the same conversation', async () => {
      const m = byId(await read())
      expect(m.get(ids.react)?.reaction).toMatchObject({ emoji: '👍', targetId: ids.t1 })
      expect(m.get(ids.removed)?.reaction).toMatchObject({ emoji: null, targetId: ids.t1 })
      // Two reactions to the same message share one opaque ref; it is not the WhatsApp id.
      const ref = m.get(ids.react)?.reaction?.targetRef
      expect(ref).toMatch(/^[0-9a-f]{16}$/)
      expect(m.get(ids.removed)?.reaction?.targetRef).toBe(ref)
      expect(m.get(ids.reactMissing)?.reaction?.targetRef).not.toBe(ref)
    })

    it('an unknown target, or one in ANOTHER conversation, stays null', async () => {
      const m = byId(await read())
      expect(m.get(ids.reactMissing)?.reaction).toMatchObject({ emoji: '❤️', targetId: null })
      expect(m.get(ids.reactCross)?.reaction).toMatchObject({ emoji: '😂', targetId: null })
    })

    it('a reply resolves its quoted message; a missing one is null; a forward marker is not a reply', async () => {
      const m = byId(await read())
      expect(m.get(ids.reply)?.replyTo).toEqual({ targetId: ids.t1 })
      expect(m.get(ids.replyMissing)?.replyTo).toEqual({ targetId: null })
      expect('replyTo' in (m.get(ids.forwarded) ?? {})).toBe(false)
    })

    it("a Coexistence echo's reply (metadata.replyTo) resolves the same way", async () => {
      expect(byId(await read()).get(ids.echoReply)?.replyTo).toEqual({ targetId: ids.t1 })
    })

    it('captions are carried; text, ids and payloads are not changed or exposed', async () => {
      const list = await read()
      const m = byId(list)
      expect(m.get(ids.captioned)?.caption).toBe('מחירון')
      expect(m.get(ids.captioned)?.text).toBe('')
      expect(m.get(ids.reply)?.text).toBe('כן')
      expect(JSON.stringify(list)).not.toContain('wamid.')
      expect(JSON.stringify(list)).not.toContain('media__refs')
    })
  })
}
