import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import {
  markHumanActiveByConversation,
  returnConversationToAgent,
  takeOverConversationByRep,
  readHumanPresence,
} from '@/db/conversationHumanPresence'
import { getAiState, recordTurn } from '@/db/conversationAiState'
import { authorizeAgentSend } from '@/lib/inbox/autoresponse/humanPresence'

/**
 * OWNERSHIP AGAINST A REAL POSTGRES.
 *
 * The state guards are WHERE clauses, not read-then-write, and that difference
 * is the whole point: a concurrent opt-out landing between a check and a write
 * must not slip through. A mocked query builder cannot demonstrate that, so
 * these run on the live test database.
 *
 * Tenant isolation is likewise structural — both writers source their row FROM
 * `inbox_conversations` with an `agencyId` predicate, so a conversation
 * belonging to another agency matches zero rows. That is asserted here against
 * a genuine second agency rather than argued from the SQL.
 */

const PHONE_ID = '__ownership_pn'
const CUSTOMER = '972500000077'

let agencyId: number
let otherAgencyId: number
let userId: number
let leadId: number
let conversationId: number
let otherConversationId: number

/**
 * `inbox_conversations_thread_uniq` spans the business phone + customer, not the
 * agency, so the two tenants need distinct numbers — a detail worth keeping
 * visible: two agencies genuinely cannot share one WhatsApp thread.
 */
async function seedAgency(
  name: string,
  suffix: string,
): Promise<{ agencyId: number; userId: number; leadId: number; conversationId: number }> {
  const [a] = await db('agencies').insert({ name, autoResponseEnabled: true }).returning('id')
  const aId = Number(a.id)
  const [u] = await db('users').insert({ firstName: 'F', role: 'AGNT', agencyId: aId }).returning('id')
  const uId = Number(u.id)
  const [c] = await db('clients')
    .insert({
      firstName: 'לקוח',
      lastName: 'בדיקה',
      phone: `${CUSTOMER}${suffix}`,
      agencyId: aId,
      userId: uId,
      createdById: uId,
      status: 'new',
    })
    .returning('id')
  const lId = Number(c.id)
  const [conv] = await db('inbox_conversations')
    .insert({
      agencyId: aId,
      leadId: lId,
      channel: 'whatsapp',
      businessPhoneNumberId: `${PHONE_ID}${suffix}`,
      customerWaId: `${CUSTOMER}${suffix}`,
      customerName: 'לקוח בדיקה',
    })
    .returning('id')
  return { agencyId: aId, userId: uId, leadId: lId, conversationId: Number(conv.id) }
}

const setState = (aiState: string, extra: Record<string, unknown> = {}) =>
  db('conversation_ai_state')
    .insert({ conversationId, agencyId, aiState, ...extra })
    .onConflict('conversationId')
    .merge({ aiState, ...extra })

const stateOf = async (id = conversationId) =>
  (await db('conversation_ai_state').where({ conversationId: id }).first('aiState', 'stoppedReason', 'aiTurnCount')) as
    | { aiState: string; stoppedReason: string | null; aiTurnCount: number }
    | undefined

beforeAll(async () => {
  const mine = await seedAgency('__test_ownership__', '1')
  agencyId = mine.agencyId
  userId = mine.userId
  leadId = mine.leadId
  conversationId = mine.conversationId
  const theirs = await seedAgency('__test_ownership_other__', '2')
  otherAgencyId = theirs.agencyId
  otherConversationId = theirs.conversationId
})

beforeEach(async () => {
  await db('conversation_ai_state').where({ conversationId }).del()
})

afterAll(async () => {
  for (const cId of [conversationId, otherConversationId]) {
    await db('conversation_ai_state').where({ conversationId: cId }).del()
    await db('inbox_messages').where({ conversationId: cId }).del()
    await db('inbox_conversations').where({ id: cId }).del()
  }
  for (const aId of [agencyId, otherAgencyId]) {
    await db('clients').where({ agencyId: aId }).del()
    await db('users').where({ agencyId: aId }).del()
    await db('agencies').where({ id: aId }).del()
  }
})

describe('an explicit take-over pauses the agent', () => {
  it('claims a conversation the agent is handling', async () => {
    await setState('ai_qualifying')
    expect(await takeOverConversationByRep({ conversationId, agencyId })).toBe(true)
    expect((await stateOf())?.aiState).toBe('human_active')
    expect((await stateOf())?.stoppedReason).toBe('human_takeover_explicit')
  })

  it('works on a conversation the agent has never touched — no row yet', async () => {
    expect(await stateOf()).toBeUndefined()
    expect(await takeOverConversationByRep({ conversationId, agencyId })).toBe(true)
    expect((await stateOf())?.aiState).toBe('human_active')
  })

  it('preserves how ownership was FIRST acquired', async () => {
    // The rep replied (human_active), then pressed the button. The history says
    // they replied — the stronger, earlier fact.
    await markHumanActiveByConversation(conversationId, agencyId)
    await takeOverConversationByRep({ conversationId, agencyId })
    expect((await stateOf())?.stoppedReason).toBe('human_active')
  })

  it('REFUSES an opted-out conversation', async () => {
    await setState('opted_out', { stoppedReason: 'opt_out' })
    expect(await takeOverConversationByRep({ conversationId, agencyId })).toBe(false)
    expect((await stateOf())?.aiState).toBe('opted_out')
    expect((await stateOf())?.stoppedReason).toBe('opt_out')
  })

  it('cannot reach another agency’s conversation', async () => {
    const before = await stateOf(otherConversationId)
    expect(await takeOverConversationByRep({ conversationId: otherConversationId, agencyId })).toBe(false)
    expect(await stateOf(otherConversationId)).toEqual(before)
  })
})

describe('returning to the agent is the only door back', () => {
  it('resumes a conversation a rep took over', async () => {
    await setState('human_active', { stoppedReason: 'human_active', aiTurnCount: 4 })
    expect(await returnConversationToAgent({ conversationId, agencyId })).toBe(true)
    const after = await stateOf()
    expect(after?.aiState).toBe('ai_qualifying')
    expect(after?.stoppedReason).toBeNull()
  })

  it('resumes after an agent handoff', async () => {
    await setState('escalated', { stoppedReason: 'human_request' })
    expect(await returnConversationToAgent({ conversationId, agencyId })).toBe(true)
    expect((await stateOf())?.aiState).toBe('ai_qualifying')
  })

  it('keeps the turn count, so the customer is not greeted a second time', async () => {
    await setState('human_active', { aiTurnCount: 7 })
    await returnConversationToAgent({ conversationId, agencyId })
    expect(Number((await stateOf())?.aiTurnCount)).toBe(7)
  })

  it('REFUSES to lift the customer’s own stop', async () => {
    await setState('opted_out', { stoppedReason: 'opt_out' })
    expect(await returnConversationToAgent({ conversationId, agencyId })).toBe(false)
    expect((await stateOf())?.aiState).toBe('opted_out')
  })

  it('REFUSES to reopen a finished conversation', async () => {
    await setState('closed', { stoppedReason: 'goodbye' })
    expect(await returnConversationToAgent({ conversationId, agencyId })).toBe(false)
    expect((await stateOf())?.aiState).toBe('closed')
  })

  it('does nothing to a conversation that is already the agent’s', async () => {
    await setState('ai_qualifying')
    expect(await returnConversationToAgent({ conversationId, agencyId })).toBe(false)
    expect((await stateOf())?.aiState).toBe('ai_qualifying')
  })

  it('cannot reach another agency’s conversation', async () => {
    await db('conversation_ai_state')
      .insert({ conversationId: otherConversationId, agencyId: otherAgencyId, aiState: 'human_active' })
      .onConflict('conversationId')
      .merge({ aiState: 'human_active' })
    expect(await returnConversationToAgent({ conversationId: otherConversationId, agencyId })).toBe(false)
    expect((await stateOf(otherConversationId))?.aiState).toBe('human_active')
  })
})

describe('nothing resumes a conversation on its own', () => {
  it('recording an agent turn does not lift a human takeover', async () => {
    await setState('human_active', { stoppedReason: 'human_active', aiTurnCount: 2 })
    await recordTurn(conversationId, { name: 'דנה' })
    const after = await stateOf()
    expect(after?.aiState, 'a recorded turn handed the conversation back').toBe('human_active')
    // The memory still advances — only the lifecycle is left alone.
    expect(Number(after?.aiTurnCount)).toBe(3)
    expect((await getAiState(conversationId))?.qualification?.name).toBe('דנה')
  })

  it('recording a turn does not lift an opt-out', async () => {
    await setState('opted_out', { stoppedReason: 'opt_out' })
    await recordTurn(conversationId, {})
    expect((await stateOf())?.aiState).toBe('opted_out')
  })

  it('an ordinary conversation still keeps qualifying', async () => {
    await setState('new')
    await recordTurn(conversationId, {})
    expect((await stateOf())?.aiState).toBe('ai_qualifying')
  })
})

describe('the send boundary agrees with the stored ownership', () => {
  it('refuses while a human owns it, and authorizes once handed back', async () => {
    await setState('human_active', { stoppedReason: 'human_active' })
    const turnStartedAt = new Date().toISOString()

    const paused = await readHumanPresence(conversationId)
    expect(authorizeAgentSend(paused, turnStartedAt)).toEqual({
      authorized: false,
      reason: 'human_active',
    })

    await returnConversationToAgent({ conversationId, agencyId })
    const resumed = await readHumanPresence(conversationId)
    expect(authorizeAgentSend(resumed, turnStartedAt)).toEqual({ authorized: true })
  })

  it('a take-over lands before the next send is authorized', async () => {
    await setState('ai_qualifying')
    const turnStartedAt = new Date().toISOString()
    expect(authorizeAgentSend(await readHumanPresence(conversationId), turnStartedAt).authorized).toBe(true)

    // The rep presses "take over" while the model is still generating.
    await takeOverConversationByRep({ conversationId, agencyId })

    // The guard re-reads at the boundary and the pending reply is suppressed.
    expect(authorizeAgentSend(await readHumanPresence(conversationId), turnStartedAt)).toEqual({
      authorized: false,
      reason: 'human_active',
    })
  })
})
