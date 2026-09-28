/**
 * "A customer is waiting for a person" against a real database.
 *
 * The bug this pins: the AI's handoff text ("a representative will get back to
 * you") is an outbound message, and the reminder used to treat ANY outbound as
 * an answer — so exactly the conversations handed to a person were the ones
 * never reminded. Only a human reply counts now: from SocialCRM, or from the
 * WhatsApp Business app (a Coexistence echo). Reading does not.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import {
  findPendingHandoffsQuery,
  findUnansweredConversationsQuery,
  UNANSWERED_THRESHOLD_MS,
} from '@/db/notifications/unanswered'
import { clearConversationAttention } from '@/db/notifications/conversationAttention'

const MIN = 60_000
let agencyId: number
let otherAgencyId: number
let userId: number
const conversations: number[] = []
let nextWamid = 0

const ago = (ms: number) => new Date(Date.now() - ms)

async function seedAgency(name: string) {
  const [a] = await db('agencies').insert({ name }).returning('id')
  const id = Number(a.id)
  const [u] = await db('users').insert({ firstName: 'Rep', role: 'ADMIN', agencyId: id }).returning('id')
  return { agencyId: id, userId: Number(u.id) }
}

async function conversation(opts: { lead?: boolean; inboundAgo: number; isPersonal?: boolean; agency?: number } = { inboundAgo: 31 * MIN }) {
  const ag = opts.agency ?? agencyId
  let leadId: number | null = null
  if (opts.lead !== false) {
    const [c] = await db('clients')
      .insert({ firstName: 'דנה', lastName: 'לוי', agencyId: ag, userId, createdById: userId, status: 'new' })
      .returning('id')
    leadId = Number(c.id)
  }
  const tag = `${Date.now()}${conversations.length}`
  const [cv] = await db('inbox_conversations')
    .insert({
      agencyId: ag,
      leadId,
      channel: 'whatsapp',
      businessPhoneNumberId: `__unanswered_pn_${tag}`,
      customerWaId: `97250${tag}`.slice(0, 15),
      lastInboundAt: ago(opts.inboundAgo),
      lastDirection: 'inbound',
      isPersonal: opts.isPersonal ?? false,
    })
    .returning('id')
  const id = Number(cv.id)
  conversations.push(id)
  return { id, leadId, agency: ag }
}

async function message(
  conv: { id: number; agency: number },
  sequence: number,
  m: { dir: 'inbound' | 'outbound'; at: Date; source?: string; userId?: number | null; status?: string },
) {
  await db('inbox_messages').insert({
    conversationId: conv.id,
    agencyId: conv.agency,
    channel: 'whatsapp',
    direction: m.dir,
    externalId: `wamid.__unanswered_${process.pid}_${nextWamid++}`,
    text: m.dir === 'inbound' ? 'שלום' : 'תשובה',
    sequence,
    status: m.status ?? (m.dir === 'inbound' ? 'received' : 'sent'),
    sentByUserId: m.userId ?? null,
    metadata: m.source ? { source: m.source } : {},
    channelTimestamp: m.at,
    createdAt: m.at,
  })
}

async function aiState(convId: number, state: string, escalatedAt?: Date) {
  await db('conversation_ai_state').insert({
    conversationId: convId,
    agencyId,
    aiState: state,
    escalatedAt: escalatedAt ?? null,
    escalationReason: escalatedAt ? 'human_request' : null,
  })
}

async function reminded(convId: number): Promise<boolean> {
  const res = (await findUnansweredConversationsQuery(new Date(Date.now() - UNANSWERED_THRESHOLD_MS), 1000)) as {
    rows: { conversationId: number }[]
  }
  return res.rows.some((r) => Number(r.conversationId) === convId)
}

async function handoffFor(convId: number) {
  const res = (await findPendingHandoffsQuery(new Date(), 1000)) as {
    rows: { conversationId: number; leadId: number | null }[]
  }
  return res.rows.find((r) => Number(r.conversationId) === convId) ?? null
}

beforeAll(async () => {
  ;({ agencyId, userId } = await seedAgency('__unanswered_db_test'))
  ;({ agencyId: otherAgencyId } = await seedAgency('__unanswered_db_test_other'))
})

afterAll(async () => {
  await db('notifications').whereIn('agencyId', [agencyId, otherAgencyId]).del()
  await db('questionnaire_sessions').whereIn('conversationId', conversations).del()
  await db('inbox_conversation_reads').whereIn('conversationId', conversations).del()
  await db('conversation_ai_state').whereIn('conversationId', conversations).del()
  await db('inbox_messages').whereIn('conversationId', conversations).del()
  await db('inbox_conversations').whereIn('id', conversations).del()
  for (const a of [agencyId, otherAgencyId]) {
    await db('clients').where({ agencyId: a }).del()
    await db('users').where({ agencyId: a }).del()
    await db('agencies').where({ id: a }).del()
  }
  await db.destroy()
})

describe('the one reminder, 30 minutes after the customer’s message', () => {
  it('fires when nothing answered the customer', async () => {
    const c = await conversation({ inboundAgo: 31 * MIN })
    await message(c, 1, { dir: 'inbound', at: ago(31 * MIN) })
    expect(await reminded(c.id)).toBe(true)
  })

  it('THE FIX: fires after the AI handed the chat to a person, even though the AI replied', async () => {
    const c = await conversation({ inboundAgo: 31 * MIN })
    await message(c, 1, { dir: 'inbound', at: ago(31 * MIN) })
    await message(c, 2, { dir: 'outbound', at: ago(30 * MIN), source: 'auto_response', userId })
    await aiState(c.id, 'escalated', ago(30 * MIN))
    expect(await reminded(c.id)).toBe(true)
  })

  it('stays silent while the AI is still handling it (nobody promised a person)', async () => {
    const c = await conversation({ inboundAgo: 31 * MIN })
    await message(c, 1, { dir: 'inbound', at: ago(31 * MIN) })
    await message(c, 2, { dir: 'outbound', at: ago(30 * MIN), source: 'auto_response', userId })
    await aiState(c.id, 'ai_qualifying')
    expect(await reminded(c.id)).toBe(false)
  })

  it('is cancelled by a reply from the WhatsApp Business app (Coexistence echo)', async () => {
    const c = await conversation({ inboundAgo: 31 * MIN })
    await message(c, 1, { dir: 'inbound', at: ago(31 * MIN) })
    await message(c, 2, { dir: 'outbound', at: ago(30 * MIN), source: 'auto_response', userId })
    await message(c, 3, { dir: 'outbound', at: ago(20 * MIN), source: 'smb_message_echo', userId: null })
    await aiState(c.id, 'escalated', ago(30 * MIN))
    expect(await reminded(c.id)).toBe(false)
  })

  it('is cancelled by a reply from SocialCRM', async () => {
    const c = await conversation({ inboundAgo: 31 * MIN })
    await message(c, 1, { dir: 'inbound', at: ago(31 * MIN) })
    await message(c, 2, { dir: 'outbound', at: ago(20 * MIN), userId })
    await aiState(c.id, 'human_active')
    expect(await reminded(c.id)).toBe(false)
  })

  it('a reply that failed to send is not an answer', async () => {
    const c = await conversation({ inboundAgo: 31 * MIN })
    await message(c, 1, { dir: 'inbound', at: ago(31 * MIN) })
    await message(c, 2, { dir: 'outbound', at: ago(20 * MIN), userId, status: 'failed' })
    await aiState(c.id, 'human_active')
    expect(await reminded(c.id)).toBe(true)
  })

  it('opening and reading the conversation is not an answer', async () => {
    const c = await conversation({ inboundAgo: 31 * MIN })
    await message(c, 1, { dir: 'inbound', at: ago(31 * MIN) })
    await db('inbox_conversation_reads').insert({ conversationId: c.id, agencyId, userId, lastReadAt: ago(5 * MIN) })
    expect(await reminded(c.id)).toBe(true)
  })

  it('an automation send still quiets an un-handed-off chat, as before', async () => {
    const c = await conversation({ inboundAgo: 31 * MIN })
    await message(c, 1, { dir: 'inbound', at: ago(31 * MIN) })
    await message(c, 2, { dir: 'outbound', at: ago(30 * MIN), userId: null })
    expect(await reminded(c.id)).toBe(false)
  })

  it('respects the 30-minute threshold and the one-day window', async () => {
    const young = await conversation({ inboundAgo: 10 * MIN })
    await message(young, 1, { dir: 'inbound', at: ago(10 * MIN) })
    const stale = await conversation({ inboundAgo: 25 * 60 * MIN })
    await message(stale, 1, { dir: 'inbound', at: ago(25 * 60 * MIN) })
    expect(await reminded(young.id)).toBe(false)
    expect(await reminded(stale.id)).toBe(false)
  })

  it('never reminds an opted-out customer or a personal chat', async () => {
    const optedOut = await conversation({ inboundAgo: 31 * MIN })
    await message(optedOut, 1, { dir: 'inbound', at: ago(31 * MIN) })
    await aiState(optedOut.id, 'opted_out')
    const personal = await conversation({ inboundAgo: 31 * MIN, isPersonal: true })
    await message(personal, 1, { dir: 'inbound', at: ago(31 * MIN) })
    expect(await reminded(optedOut.id)).toBe(false)
    expect(await reminded(personal.id)).toBe(false)
  })

  it('imported history is never the message being waited on', async () => {
    const c = await conversation({ inboundAgo: 31 * MIN })
    await message(c, 1, { dir: 'inbound', at: ago(31 * MIN), source: 'whatsapp_history' })
    expect(await reminded(c.id)).toBe(false)
  })
})

describe('the handoff notification', () => {
  it('finds a handoff nobody has answered, with its ליד', async () => {
    const c = await conversation({ inboundAgo: 2 * MIN })
    await message(c, 1, { dir: 'inbound', at: ago(2 * MIN) })
    await message(c, 2, { dir: 'outbound', at: ago(1 * MIN), source: 'auto_response', userId })
    await aiState(c.id, 'escalated', ago(1 * MIN))
    expect(Number((await handoffFor(c.id))?.leadId)).toBe(c.leadId)
  })

  it('includes a conversation with no ליד (it will go to the admins)', async () => {
    const c = await conversation({ lead: false, inboundAgo: 2 * MIN })
    await message(c, 1, { dir: 'inbound', at: ago(2 * MIN) })
    await aiState(c.id, 'escalated', ago(1 * MIN))
    const row = await handoffFor(c.id)
    expect(row).not.toBeNull()
    expect(row?.leadId).toBeNull()
  })

  it('a human reply after the handoff resolves it; one before it does not', async () => {
    const answered = await conversation({ inboundAgo: 5 * MIN })
    await message(answered, 1, { dir: 'inbound', at: ago(5 * MIN) })
    await aiState(answered.id, 'escalated', ago(4 * MIN))
    await message(answered, 2, { dir: 'outbound', at: ago(1 * MIN), source: 'smb_message_echo' })

    const earlier = await conversation({ inboundAgo: 5 * MIN })
    await message(earlier, 1, { dir: 'outbound', at: ago(10 * MIN), userId })
    await message(earlier, 2, { dir: 'inbound', at: ago(5 * MIN) })
    await aiState(earlier.id, 'escalated', ago(4 * MIN))

    expect(await handoffFor(answered.id)).toBeNull()
    expect(await handoffFor(earlier.id)).not.toBeNull()
  })

  it('leaves questionnaire handoffs to lead.questionnaire_handoff', async () => {
    const c = await conversation({ inboundAgo: 3 * MIN })
    await message(c, 1, { dir: 'inbound', at: ago(3 * MIN) })
    const escalatedAt = ago(2 * MIN)
    await aiState(c.id, 'escalated', escalatedAt)
    await db('questionnaire_sessions').insert({
      conversationId: c.id,
      agencyId,
      definition: {},
      status: 'completed',
      endedReason: 'completed',
      endedAt: escalatedAt,
    })
    expect(await handoffFor(c.id)).toBeNull()
  })

  it('ignores handoffs older than a day', async () => {
    const c = await conversation({ inboundAgo: 26 * 60 * MIN })
    await aiState(c.id, 'escalated', ago(25 * 60 * MIN))
    expect(await handoffFor(c.id)).toBeNull()
  })
})

describe('a human reply clears what was already delivered', () => {
  it('marks only this conversation’s waiting notifications read, in this agency', async () => {
    const c = await conversation({ inboundAgo: 31 * MIN })
    const other = await conversation({ inboundAgo: 31 * MIN })
    const row = (collapseKey: string, ag = agencyId) => ({
      agencyId: ag,
      userId,
      type: 'message.unanswered',
      category: 'messages',
      priority: 'high',
      title: 't',
      deepLink: '/inbox',
      collapseKey,
    })
    await db('notifications').insert([
      row(`conversation:${c.id}:unanswered`),
      row(`conversation:${c.id}:handoff`),
      row(`conversation:${c.id}:inbound`),
      row(`conversation:${other.id}:unanswered`),
    ])

    const cleared = await clearConversationAttention(db, { agencyId, conversationId: c.id })
    expect(cleared).toBe(2)
    const unread = await db('notifications').where({ agencyId }).whereNull('readAt').pluck('collapseKey')
    expect(unread.sort()).toEqual([`conversation:${c.id}:inbound`, `conversation:${other.id}:unanswered`].sort())
  })

  it('never touches another agency', async () => {
    const c = await conversation({ inboundAgo: 31 * MIN })
    await db('notifications').insert({
      agencyId: otherAgencyId,
      userId: (await db('users').where({ agencyId: otherAgencyId }).first('id')).id,
      type: 'message.unanswered',
      category: 'messages',
      priority: 'high',
      title: 't',
      deepLink: '/inbox',
      collapseKey: `conversation:${c.id}:unanswered`,
    })
    expect(await clearConversationAttention(db, { agencyId, conversationId: c.id })).toBe(0)
  })
})
