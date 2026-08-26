/**
 * Wave 2A.1 — WhatsApp Coexistence message echoes.
 *
 * An echo is the business's own outbound message, sent from their WhatsApp
 * Business app and reported to us after the fact. Discarding it was a LIVE
 * correctness bug, not a missing feature: without it the CRM held only the
 * customer's half of a coexistence conversation, so `lastHumanOutboundAt`
 * stayed null and the product told a rep "this customer is waiting" about a
 * thread the business had already answered.
 *
 * The regression at the bottom of this file is the one that matters
 * commercially. Everything above it protects the two things that make the fix
 * safe: an echo is OUTBOUND, and it runs none of the inbound side effects.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseMessageEcho, parseMessageEchoes, echoPhoneNumberId } from '@/lib/whatsapp/parseMessageEcho'
import { isWaitingForReply } from '@/lib/today/waitingReply'

const TS = '1738796547'
const TS_MS = 1_738_796_547_000

/** The payload shape the shipped coexistence webhook test already fixtures. */
const echoValue = (over: Record<string, unknown> = {}) => ({
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
  message_echoes: [
    { from: '15550783881', to: '16505551234', id: 'wamid.ECHO', timestamp: TS, type: 'text', text: { body: 'on my way' } },
  ],
  ...over,
})

// ───────────────────────── 1, 4, 5, 20 · parsing ─────────────────────────────

describe('1 · echo payload is parsed', () => {
  it('reads the message from message_echoes, not messages', () => {
    const [echo] = parseMessageEchoes(echoValue())
    expect(echo.text).toBe('on my way')
    expect(echo.type).toBe('text')
  })

  it('treats `to` as the CUSTOMER and `from` as the business', () => {
    // The mirror of an inbound message. Reading `from` as the customer would
    // create a conversation with the business's own number.
    const [echo] = parseMessageEchoes(echoValue())
    expect(echo.customerWaId).toBe('16505551234')
    expect(echo.businessWaId).toBe('15550783881')
  })

  it('5 · the real wamid becomes the externalId', () => {
    const [echo] = parseMessageEchoes(echoValue())
    expect(echo.externalId).toBe('wamid.ECHO')
  })

  it('4 · the real Meta timestamp is preserved, never the clock', () => {
    const [echo] = parseMessageEchoes(echoValue())
    expect(echo.channelTimestamp).toBeInstanceOf(Date)
    expect(echo.channelTimestamp!.getTime()).toBe(TS_MS)
  })

  it('reads the business phone_number_id from metadata — the tenant key', () => {
    expect(echoPhoneNumberId(echoValue())).toBe('106540352242922')
  })
})

describe('20 · missing or unsupported payloads fail safely', () => {
  it('refuses an echo with no recipient — there is no conversation to resolve', () => {
    expect(parseMessageEcho({ from: 'x', id: 'wamid.1', timestamp: TS })).toBeNull()
  })

  it('refuses an echo with no wamid — it could never be deduplicated', () => {
    expect(parseMessageEcho({ from: 'x', to: 'y', timestamp: TS })).toBeNull()
  })

  it('returns [] for every unusable value rather than throwing', () => {
    for (const bad of [null, undefined, 'string', 42, [], {}, { message_echoes: 'nope' }]) {
      expect(parseMessageEchoes(bad)).toEqual([])
    }
  })

  it('skips a malformed entry without stranding its siblings', () => {
    const value = echoValue({
      message_echoes: [
        { from: 'b', to: 'c1', id: 'wamid.A', timestamp: TS, type: 'text', text: { body: 'a' } },
        { from: 'b', id: 'wamid.BROKEN', timestamp: TS }, // no `to`
        { from: 'b', to: 'c2', id: 'wamid.C', timestamp: TS, type: 'text', text: { body: 'c' } },
      ],
    })
    expect(parseMessageEchoes(value).map((e) => e.externalId)).toEqual(['wamid.A', 'wamid.C'])
  })

  it('yields no phone_number_id for a malformed envelope', () => {
    for (const bad of [null, {}, { metadata: null }, { metadata: {} }]) {
      expect(echoPhoneNumberId(bad)).toBeNull()
    }
  })

  it('carries a non-text echo through without inventing a body', () => {
    const value = echoValue({
      message_echoes: [{ from: 'b', to: 'c', id: 'wamid.IMG', timestamp: TS, type: 'image', image: { id: 'M1' } }],
    })
    const [echo] = parseMessageEchoes(value)
    expect(echo.type).toBe('image')
    expect(echo.text).toBe('')
  })
})

// ───────── 2, 3, 6–11, 13, 17–19 · persistence contract, read from source ────

/**
 * The persistence module is asserted at the source level rather than against a
 * hand-built knex double. A mock of `findOrCreateConversation` +
 * `insertOutboundMessage` + `bumpConversationOnOutbound` would only prove the
 * mock was called; what has to be true here is which primitives are used, what
 * is gated on a real insert, and what is NOT reachable at all. The behavioural
 * halves — parsing above, waiting-reply below — are executed for real.
 */
describe('persistence contract', () => {
  const src = readFileSync('lib/inbox/ingestWhatsappEcho.ts', 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

  it('2 · resolves the conversation by agency + business phone + customer', () => {
    expect(code).toContain('findOrCreateConversation')
    expect(code).toContain('businessPhoneNumberId')
    expect(code).toContain('customerWaId: echo.customerWaId')
  })

  it('17 · derives the agency from the connected business phone, never the customer', () => {
    expect(code).toContain("db('whatsapp_connections')")
    expect(code).toContain('phone_number_id: phoneNumberId')
    // The customer's number is payload data and is never a tenant key.
    expect(code).not.toMatch(/where\([^)]*customerWaId[^)]*\)\s*\.first\('agency/)
  })

  it('3 · persists through the existing OUTBOUND primitive', () => {
    expect(code).toContain('insertOutboundMessage')
    expect(code).not.toContain('insertInboundMessage')
  })

  it('4 · passes the real Meta timestamp to both the row and the bump', () => {
    expect(code).toContain('channelTimestamp: echo.channelTimestamp')
    expect(code).toContain('bumpConversationOnOutbound(trx, conversationId, echo.channelTimestamp')
    // `persistOutboundWhatsapp` uses `new Date()` in both places; this must not.
    expect(code).not.toMatch(/channelTimestamp:\s*new Date\(\)/)
  })

  it('5 · uses the wamid as externalId, which is the dedup key', () => {
    expect(code).toContain('externalId: echo.externalId')
  })

  it('6–8 · every conversation side effect is gated on a genuine insert', () => {
    // A redelivery must not bump messageCount or drag lastMessageAt forward.
    expect(code).toMatch(/if \(!inserted\) return 'duplicate'/)
    const afterGate = code.slice(code.indexOf("if (!inserted) return 'duplicate'"))
    expect(afterGate).toContain('bumpConversationOnOutbound')
  })

  it('9–10 · uses the OUTBOUND bump, which zeroes unread rather than incrementing it', () => {
    expect(code).toContain('bumpConversationOnOutbound')
    expect(code).not.toContain('bumpConversationOnInbound')
    // Assert the helper's own semantics, so a change there fails here.
    const conv = readFileSync('db/inboxConversations.ts', 'utf8')
    const bump = conv.slice(conv.indexOf('export async function bumpConversationOnOutbound'))
    const body = bump.slice(0, bump.indexOf('\n}'))
    expect(body).toContain("lastDirection: 'outbound'")
    expect(body).toContain('unreadCount: 0')
    expect(body).not.toMatch(/unreadCount.*\+ 1/)
  })

  it('11 · the source marker keeps the echo counting as a HUMAN outbound', () => {
    expect(code).toContain("source: ECHO_SOURCE")
    expect(src).toContain("export const ECHO_SOURCE = 'smb_message_echo'")
    // `leadFacts` computes lastHumanOutboundAt as outbound WHERE source IS
    // DISTINCT FROM 'auto_response'. Marking an echo that way would preserve the
    // exact bug this wave fixes.
    expect(src).not.toMatch(/ECHO_SOURCE\s*=\s*'auto_response'/)
    const facts = readFileSync('db/ai/leadFacts.ts', 'utf8')
    expect(facts).toContain("(m.metadata->>'source') IS DISTINCT FROM ?")
  })

  it('uses the established metadata convention rather than a new one', () => {
    expect(code).toContain('metadata || ?::jsonb')
  })

  it('13 · no lead is ever created, and an existing link is never cleared', () => {
    expect(code).not.toContain('createLeadFromWhatsappWebhook')
    expect(code).not.toContain('upsertLead')
    expect(code).toContain('leadId: null')
    // The upsert's merge clause must not carry leadId, or null would wipe it.
    const conv = readFileSync('db/inboxConversations.ts', 'utf8')
    const upsert = conv.slice(conv.indexOf('export async function findOrCreateConversation'))
    const merge = upsert.slice(upsert.indexOf('.merge('), upsert.indexOf('.returning('))
    expect(merge).not.toContain('leadId')
  })

  it('18–19 · the message inherits the conversation’s own lead, lead-linked or not', () => {
    // Read back inside the transaction rather than assumed, so a Contact thread
    // stays leadless and a Lead thread produces lead-linked messages.
    expect(code).toContain("first('leadId')")
    expect(code).toContain('leadId,')
  })

  it('attributes the message to no SocialCRM user', () => {
    expect(code).toContain('sentByUserId: null')
  })
})

// ───────────────────── 12, 14, 15, 16 · side-effect safety ───────────────────

describe('12, 14–16 · the echo path cannot run inbound side effects', () => {
  // CODE only. The module documents each of these by name to explain why it
  // must never call them, so scanning raw text would flag the very prose that
  // exists to prevent the thing being tested.
  const src = readFileSync('lib/inbox/ingestWhatsappEcho.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

  it('imports none of them — the guarantee is structural, not a boolean', () => {
    for (const forbidden of [
      'enqueueInboundAutoResponse', // 12 · no auto-response
      'createLeadFromWhatsappWebhook', // 13 · no lead
      'notifyEvent', // 14 · no inbound notification
      'emitAutomationEvent', // no lead_created automation
      'enqueueConversationAnalysis', // 16 · no analysis meant for fresh inbound
      'runAutoResponseKick',
      'ingestWhatsappInbound',
    ]) {
      expect(src).not.toContain(forbidden)
    }
  })

  it('15 · cannot create an unanswered signal — it never writes an inbound message', () => {
    // `message.unanswered` and `conversation.unanswered` both key off an inbound
    // head. An outbound row cannot produce either.
    expect(src).not.toContain('insertInboundMessage')
    expect(src).not.toContain("direction: 'inbound'")
  })

  it('does not reuse persistOutboundWhatsapp, which enqueues analysis and bumps unconditionally', () => {
    expect(src).not.toContain('persistOutboundWhatsapp')
  })
})

// ───────────────────────── THE PRODUCT REGRESSION ────────────────────────────

/**
 * The reason this wave exists, executed for real against the shipped rule.
 *
 * `isWaitingForReply` is the single authority behind Today's WAITING_REPLY and
 * the `conversation.unanswered` signal, and `db/ai/leadFacts.ts` feeds it
 * `lastHumanOutboundAt` = newest outbound whose `metadata.source` is not
 * `auto_response`. A persisted echo lands in exactly that set.
 */
describe('REGRESSION · an answered conversation is no longer "waiting for us"', () => {
  const nowMs = TS_MS + 60 * 60 * 1000 // an hour after the business replied
  const customerWroteAt = TS_MS - 10 * 60 * 1000 // ten minutes before that

  it('BEFORE the fix: the echo is discarded, so the thread looks unanswered', () => {
    const waiting = isWaitingForReply({
      lastInboundAt: customerWroteAt,
      lastHumanOutboundAt: null, // the echo was thrown away
      nowMs,
    })
    expect(waiting).toBe(true) // the bug: a rep is told to reply to an answered thread
  })

  it('AFTER the fix: the persisted echo clears the waiting state', () => {
    const waiting = isWaitingForReply({
      lastInboundAt: customerWroteAt,
      lastHumanOutboundAt: TS_MS, // the echo, counted as a human reply
      nowMs,
    })
    expect(waiting).toBe(false)
  })

  it('a customer message AFTER the echo correctly waits again', () => {
    const waiting = isWaitingForReply({
      lastInboundAt: TS_MS + 5 * 60 * 1000,
      lastHumanOutboundAt: TS_MS,
      nowMs,
    })
    expect(waiting).toBe(true)
  })

  it('an auto-response would NOT have cleared it — only a human reply does', () => {
    // Why ECHO_SOURCE must not be 'auto_response': leadFacts excludes that
    // source from lastHumanOutboundAt, so the thread would still read as waiting.
    const asAutoResponse = isWaitingForReply({ lastInboundAt: customerWroteAt, lastHumanOutboundAt: null, nowMs })
    expect(asAutoResponse).toBe(true)
  })
})

// ───────────────────────── 10 · the history gate is untouched ────────────────

describe('independent of history', () => {
  it('HISTORY_SYNC_ENABLED remains exactly false', () => {
    const src = readFileSync('lib/whatsapp/coexistence.ts', 'utf8')
    expect(src).toContain('export const HISTORY_SYNC_ENABLED = false')
  })

  it('state_sync is still acknowledged and unread; history is GATED, not unhandled', () => {
    const src = readFileSync('lib/whatsapp/coexistence.ts', 'utf8')
    const handler = src.slice(src.indexOf('export async function processCoexistenceWebhook'))
    const body = handler.slice(0, handler.indexOf('\n}'))
    expect(body).toContain("field === 'smb_message_echoes'")
    // Wave 2A.2d added a history branch. It is unconditionally wrapped in the
    // gate, so while HISTORY_SYNC_ENABLED is false the receive path cannot run
    // — the original guarantee, now enforced by a branch rather than by absence.
    expect(body).toContain("field === 'history'")
    expect(body).toContain('if (HISTORY_SYNC_ENABLED) {')
    expect(body.indexOf('if (HISTORY_SYNC_ENABLED)')).toBeLessThan(body.indexOf('receiveHistoryWebhook'))
    // smb_app_state_sync still has no branch at all.
    expect(body).not.toContain("field === 'smb_app_state_sync'")
  })

  it('the echo path never touches history', () => {
    const src = readFileSync('lib/inbox/ingestWhatsappEcho.ts', 'utf8')
    expect(src).not.toContain('HISTORY_SYNC_ENABLED')
    expect(src).not.toContain('syncSmbAppData')
  })
})
