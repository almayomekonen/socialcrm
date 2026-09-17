import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { detectOptOut } from '@/lib/inbox/autoresponse/qualify'
import { decidePreGeneration, type PreFacts } from '@/lib/inbox/autoresponse/stateMachine'
import { decideCourtesyClose } from '@/lib/inbox/autoresponse/courtesyClose'
import { authorizeAgentSend } from '@/lib/inbox/autoresponse/humanPresence'
import { readHumanPresence } from '@/db/conversationHumanPresence'
import { markStopped } from '@/db/conversationAiState'

/**
 * "הסירו אותי" / "תסירו אותי מהרשימה" — plural imperatives asking to be taken
 * off the list.
 *
 * The opt-out list carried `הסר אותי` (singular) and `להסיר` (infinitive) but
 * neither plural form, so both of these ordinary phrasings were NOT opt-outs:
 * the agent kept replying, and after a handoff it would still have sent a
 * courtesy line to someone who had just asked to be removed.
 *
 * This walks the whole stop: detected → agent stops → courtesy refused →
 * persisted as opted_out → refused again at the send boundary.
 */

const PHONE_ID = '__optout_pn'
const CUSTOMER = '972500000456'

let agencyId: number
let userId: number
let leadId: number
let conversationId: number

const THE_PHRASES = ['הסירו אותי', 'תסירו אותי מהרשימה']

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_optout__', autoResponseEnabled: true }).returning('id')
  agencyId = Number(a.id)
  const [u] = await db('users').insert({ firstName: 'F', role: 'AGNT', agencyId }).returning('id')
  userId = Number(u.id)
  const [c] = await db('clients')
    .insert({ firstName: 'לקוח', lastName: 'בדיקה', phone: CUSTOMER, agencyId, userId, createdById: userId, status: 'new' })
    .returning('id')
  leadId = Number(c.id)
  const [conv] = await db('inbox_conversations')
    .insert({
      agencyId,
      leadId,
      channel: 'whatsapp',
      businessPhoneNumberId: PHONE_ID,
      customerWaId: CUSTOMER,
      customerName: 'לקוח בדיקה',
    })
    .returning('id')
  conversationId = Number(conv.id)
})

beforeEach(async () => {
  await db('conversation_ai_state').where({ conversationId }).del()
})

afterAll(async () => {
  await db('conversation_ai_state').where({ conversationId }).del()
  await db('inbox_messages').where({ conversationId }).del()
  await db('inbox_conversations').where({ id: conversationId }).del()
  await db('clients').where({ id: leadId }).del()
  await db('users').where({ id: userId }).del()
  await db('agencies').where({ id: agencyId }).del()
})

const pre = (over: Partial<PreFacts> = {}): PreFacts => ({
  aiState: 'ai_qualifying',
  masterEnabled: true,
  channelEnabled: true,
  humanTookOver: false,
  humanTyping: false,
  optOut: false,
  hasUnansweredInbound: true,
  withinQuietHours: false,
  withinWindow: true,
  sentTodayForAgency: 0,
  dailyCap: 200,
  turnCount: 3,
  maxTurns: 5,
  ...over,
})

describe('the exact phrases are opt-outs', () => {
  for (const phrase of THE_PHRASES) {
    it(`detects: ${phrase}`, () => {
      expect(detectOptOut(phrase)).toBe(true)
    })
  }

  it('covers the near neighbours a customer would actually type', () => {
    for (const t of [
      'הסירו אותי מהרשימה',
      'תסירו אותי',
      'הסירו אותנו',
      'תורידו אותי',
      'אנא הסירו אותי מרשימת התפוצה',
      'הסירו אותי בבקשה',
    ]) {
      expect(detectOptOut(t), t).toBe(true)
    }
  })
})

describe('an opt-out stops every automated reply', () => {
  for (const phrase of THE_PHRASES) {
    it(`stops the agent and marks opted_out: ${phrase}`, () => {
      const d = decidePreGeneration(pre({ optOut: detectOptOut(phrase) }))
      expect(d.action).toBe('stop')
      expect('state' in d ? d.state : '').toBe('opted_out')
    })
  }

  it('stops even on an escalated conversation, which is otherwise a hard skip', () => {
    // optOut is evaluated BEFORE the escalated skip, so the stop still persists.
    const d = decidePreGeneration(pre({ aiState: 'escalated', optOut: true }))
    expect(d.action).toBe('stop')
    expect('state' in d ? d.state : '').toBe('opted_out')
  })

  it('REFUSES THE COURTESY REPLY — even when the message also reads as thanks', () => {
    for (const phrase of [...THE_PHRASES, 'תודה, הסירו אותי מהרשימה']) {
      expect(
        decideCourtesyClose({
          inboundText: 'תודה רבה',
          agentHasSpoken: true,
          humanTookOver: false,
          optOut: detectOptOut(phrase),
          alreadySentCourtesy: false,
        }),
        phrase,
      ).toEqual({ send: false, reason: 'opted_out' })
    }
  })
})

describe('it persists, and blocks pending sends at the boundary', () => {
  for (const phrase of THE_PHRASES) {
    it(`persists through the existing mechanism and refuses the send: ${phrase}`, async () => {
      await db('conversation_ai_state').insert({ conversationId, agencyId, aiState: 'ai_qualifying', aiTurnCount: 2 })
      const turnStartedAt = new Date().toISOString()

      // Before: the agent is free to speak.
      expect(authorizeAgentSend(await readHumanPresence(conversationId), turnStartedAt).authorized).toBe(true)

      // The worker's own path: decidePreGeneration says stop → markStopped.
      const d = decidePreGeneration(pre({ optOut: detectOptOut(phrase) }))
      expect(d.action).toBe('stop')
      await markStopped(conversationId, 'opted_out', 'opt_out')

      const row = await db('conversation_ai_state').where({ conversationId }).first('aiState', 'stoppedReason')
      expect(row?.aiState).toBe('opted_out')
      expect(row?.stoppedReason).toBe('opt_out')

      // A reply already generated for this turn is refused at the boundary.
      expect(authorizeAgentSend(await readHumanPresence(conversationId), turnStartedAt)).toEqual({
        authorized: false,
        reason: 'opted_out',
      })
    })
  }

  it('and stays stopped on every later turn', async () => {
    await db('conversation_ai_state').insert({
      conversationId,
      agencyId,
      aiState: 'opted_out',
      stoppedReason: 'opt_out',
    })
    expect(decidePreGeneration(pre({ aiState: 'opted_out', optOut: false })).action).toBe('skip')
    expect(authorizeAgentSend(await readHumanPresence(conversationId), new Date().toISOString())).toEqual({
      authorized: false,
      reason: 'opted_out',
    })
  })
})

describe('ordinary discussion does not trigger it', () => {
  it('a removal verb with a non-personal object is not an opt-out', () => {
    for (const t of [
      'תסירו את הכתם מהשטיח',
      'הסירו את המדבקה מהרכב',
    ]) {
      expect(detectOptOut(t), t).toBe(false)
    }
  })

  it('a QUOTED example is a message about the phrase, not the phrase', () => {
    for (const t of [
      'לקוח כתב לי "הסירו אותי" ומה עכשיו?',
      'שאלה: מה קורה אם מישהו כותב ״תסירו אותי מהרשימה״?',
    ]) {
      expect(detectOptOut(t), t).toBe(false)
    }
  })

  /**
   * PRE-EXISTING over-broad matches, asserted so they stay visible rather than
   * being rediscovered later. Both come from the original OPTOUT_PATTERNS — the
   * bare `להסיר` and the English `remove me` — not from the patterns added here,
   * and the quote guard deliberately does not cover them.
   *
   * Left as they are on purpose. An over-broad opt-out fails SAFE: it stops
   * messaging someone who may not have asked. Narrowing a compliance stop fails
   * UNSAFE: it keeps messaging someone who did. Tightening them is its own
   * decision with its own evidence, not a mid-release edit.
   */
  it('KNOWN: the pre-existing patterns are broader than the ones added here', () => {
    expect(detectOptOut('אפשר להסיר את הגלגל?'), 'bare להסיר, pre-existing').toBe(true)
    expect(detectOptOut("someone replied 'remove me from the list'"), 'English remove me, pre-existing').toBe(true)
    // The patterns added by this change do NOT behave that way:
    expect(detectOptOut('תסירו את הכתם מהשטיח')).toBe(false)
    expect(detectOptOut('\u05dc\u05e7\u05d5\u05d7 \u05db\u05ea\u05d1 \u05dc\u05d9 "\u05d4\u05e1\u05d9\u05e8\u05d5 \u05d0\u05d5\u05ea\u05d9" \u05d5\u05de\u05d4 \u05e2\u05db\u05e9\u05d9\u05d5?')).toBe(false)
  })

  it('and none of the ordinary conversation turns trigger it', () => {
    for (const t of ['תודה רבה', 'כן אשמח במיידי!', 'קרן מקונן', 'עסק למספרת כלבים', 'מחר', 'טויוטה 2020']) {
      expect(detectOptOut(t), t).toBe(false)
    }
  })
})
