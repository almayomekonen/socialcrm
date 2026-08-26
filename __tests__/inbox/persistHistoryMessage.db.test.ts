import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { persistHistoryMessage, resolveHistoryTenant, type HistoryPersistContext } from '@/lib/inbox/persistHistoryMessage'
import { parseHistoryValue } from '@/lib/whatsapp/parseHistory'
import type { ParsedHistoryChunk, ParsedHistoryMessage } from '@/lib/whatsapp/historyEvent'
import { HISTORY_CHUNK_VALUE, CUSTOMER_A, CUSTOMER_B } from '../whatsapp/fixtures/historyPayloads'

/**
 * Wave 2A.2c — history persistence, against a real PostgreSQL.
 *
 * The invariants here are behavioural, not structural: "the conversation is
 * unchanged", "a duplicate is a no-op", "no lead is created". A mocked query
 * builder cannot prove any of them, so this runs on the live test database.
 *
 * Every assertion is about what did NOT happen as much as what did. History is
 * passive archival data; the day it starts bumping a conversation is the day a
 * four-month-old message shows up at the top of a rep's inbox.
 */

const PHONE_ID = '__hist_pn_1'
const OTHER_PHONE_ID = '__hist_pn_2'

let agencyId: number
let otherAgencyId: number
let leadId: number
let convLead: number
let convLeadless: number
let convOther: number

const CONV_STATE = [
  'unreadCount',
  'messageCount',
  'lastMessageAt',
  'lastInboundAt',
  'lastDirection',
  'lastMessagePreview',
  'leadId',
] as const

async function conversationState(id: number) {
  const cols = await db('inbox_conversations').columnInfo()
  const present = CONV_STATE.filter((c) => c in cols)
  return db('inbox_conversations').where({ id }).first(...present)
}

/** The parsed fixture, so persistence is tested against real parser output. */
const CHUNK = parseHistoryValue(HISTORY_CHUNK_VALUE) as ParsedHistoryChunk
const msgOutboundEcho = CHUNK.threads[0].messages[0]
const msgPlaceholder = CHUNK.threads[0].messages[1]
const msgInbound = CHUNK.threads[0].messages[2]
const msgThreadB = CHUNK.threads[1].messages[0]

const ctxFor = (over: Partial<HistoryPersistContext> = {}): HistoryPersistContext => ({
  agencyId,
  phoneNumberId: PHONE_ID,
  phase: CHUNK.phase,
  chunkOrder: CHUNK.chunkOrder,
  progress: CHUNK.progress,
  ...over,
})

beforeAll(async () => {
  const [a] = await db('agencies').insert({ name: '__test_history__' }).returning('id')
  agencyId = Number(a.id)
  const [b] = await db('agencies').insert({ name: '__test_history_other__' }).returning('id')
  otherAgencyId = Number(b.id)

  const [u] = await db('users').insert({ firstName: 'H', role: 'AGNT', agencyId }).returning('id')
  const [u2] = await db('users')
    .insert({ firstName: 'H2', role: 'AGNT', agencyId: otherAgencyId })
    .returning('id')

  await db('whatsapp_connections').insert([
    { user_id: u.id, agency_id: agencyId, phone_number_id: PHONE_ID, access_token: 'x' },
    { user_id: u2.id, agency_id: otherAgencyId, phone_number_id: OTHER_PHONE_ID, access_token: 'x' },
  ])

  const [l] = await db('clients')
    .insert({ firstName: '__test__', lastName: 'Lead', agencyId, userId: u.id, createdById: u.id, lead: true, status: 'new' })
    .returning('id')
  leadId = Number(l.id)

  const [c1] = await db('inbox_conversations')
    .insert({ agencyId, leadId, businessPhoneNumberId: PHONE_ID, customerWaId: CUSTOMER_A, unreadCount: 3 })
    .returning('id')
  convLead = Number(c1.id)

  const [c2] = await db('inbox_conversations')
    .insert({ agencyId, leadId: null, businessPhoneNumberId: PHONE_ID, customerWaId: CUSTOMER_B })
    .returning('id')
  convLeadless = Number(c2.id)

  // Same customer, different tenant — the isolation case.
  const [c3] = await db('inbox_conversations')
    .insert({ agencyId: otherAgencyId, leadId: null, businessPhoneNumberId: OTHER_PHONE_ID, customerWaId: CUSTOMER_A })
    .returning('id')
  convOther = Number(c3.id)
})

afterAll(async () => {
  await db('inbox_messages').whereIn('conversationId', [convLead, convLeadless, convOther]).del()
  await db('inbox_conversations').whereIn('id', [convLead, convLeadless, convOther]).del()
  await db('whatsapp_connections').whereIn('phone_number_id', [PHONE_ID, OTHER_PHONE_ID]).del()
  await db('clients').where({ id: leadId }).del()
  await db('users').whereIn('agencyId', [agencyId, otherAgencyId]).del()
  await db('agencies').whereIn('id', [agencyId, otherAgencyId]).del()
  await db.destroy()
})

describe('tenant resolution', () => {
  it('T27a: phone_number_id → agencyId, the only trusted tenant input', async () => {
    expect(await resolveHistoryTenant(PHONE_ID)).toBe(agencyId)
    expect(await resolveHistoryTenant(OTHER_PHONE_ID)).toBe(otherAgencyId)
    expect(await resolveHistoryTenant('__no_such_connection')).toBeNull()
  })

  it('T27: a wrong pairing never reaches ANOTHER tenant’s conversation', async () => {
    // The customer wa_id exists under BOTH agencies. Since F-3 a missing
    // conversation is created rather than refused, so the guarantee here is
    // narrower and sharper: whatever happens, agency B's existing thread is
    // never written to. The (agencyId, phoneNumberId) pairing itself is
    // re-verified once per delivery by the worker, which is the only caller
    // that constructs a ctx — see historyImport.db.test.ts.
    await persistHistoryMessage(msgInbound, ctxFor({ agencyId: otherAgencyId })).catch(() => null)
    await persistHistoryMessage(msgInbound, ctxFor({ phoneNumberId: OTHER_PHONE_ID })).catch(() => null)

    expect(await db('inbox_messages').where({ conversationId: convOther }).count()).toEqual([{ count: '0' }])
  })
})

describe('inserting a historical message', () => {
  let before: Record<string, unknown> | undefined
  let result: Awaited<ReturnType<typeof persistHistoryMessage>>

  beforeAll(async () => {
    before = await conversationState(convLead)
    result = await persistHistoryMessage(msgInbound, ctxFor())
  })

  const row = () => db('inbox_messages').where({ externalId: msgInbound.externalId }).first()

  it('T1: inserts, and reports the conversation and lead it attached to', async () => {
    expect(result).toEqual({
      outcome: 'inserted',
      messageId: expect.any(Number),
      conversationId: convLead,
      leadId,
    })
    expect(await row()).toBeTruthy()
  })

  it('T2/T3/T4: channel, wamid and derived direction', async () => {
    const r = await row()
    expect(r.channel).toBe('whatsapp')
    expect(r.externalId).toBe(msgInbound.externalId)
    expect(r.direction).toBe('inbound')
  })

  it('T5: the body is persisted as parsed', async () => {
    expect((await row()).text).toBe('Synthetic inbound body')
  })

  it('T6/T7: channelTimestamp is Meta’s moment; createdAt stays ingestion time', async () => {
    const r = await row()
    expect(new Date(r.channelTimestamp).toISOString()).toBe(msgInbound.channelTimestamp!.toISOString())
    // 2025-02-10 vs now: the two must never be conflated.
    expect(new Date(r.createdAt).getTime()).toBeGreaterThan(new Date(r.channelTimestamp).getTime())
    expect(Date.now() - new Date(r.createdAt).getTime()).toBeLessThan(60_000)
  })

  it('T8/T9: the history marker is merged, not assigned', async () => {
    const r = await row()
    expect(r.metadata.source).toBe('whatsapp_history')
    // The insert wrote {}; the merge added to it rather than replacing the column.
    expect(Object.keys(r.metadata).sort()).toEqual(['history', 'source'])
  })

  it('T10/T11/T12/T13/T14: chunk identity and Meta’s own fields are preserved', async () => {
    const h = (await row()).metadata.history
    expect(h.phase).toBe(0)
    expect(h.chunkOrder).toBe(1)
    expect(h.progress).toBe(55)
    expect(h.status).toBe('READ')
    expect(h.rawType).toBe('text')
    expect(h.mediaPlaceholder).toBe(false)
  })

  it('T15: the conversation’s existing lead is carried onto the message', async () => {
    expect(Number((await row()).leadId)).toBe(leadId)
  })

  it('T21/T22/T23: the conversation is byte-for-byte unchanged', async () => {
    expect(await conversationState(convLead)).toEqual(before)
  })

  it('T17: no lead was created', async () => {
    expect(await db('clients').where({ agencyId }).count()).toEqual([{ count: '1' }])
  })

  it('T5b: sequence is assigned by the existing arrival mechanism', async () => {
    // Valid and non-null, but NOT the chronological key — that is
    // COALESCE(channelTimestamp, createdAt), id per Wave 2A.2a.
    expect(Number((await row()).sequence)).toBeGreaterThan(0)
  })
})

describe('idempotency', () => {
  it('T18/T19/T20: a redelivery is a no-op — no row, no state, no metadata change', async () => {
    const before = await conversationState(convLead)
    const metaBefore = (await db('inbox_messages').where({ externalId: msgInbound.externalId }).first()).metadata

    const again = await persistHistoryMessage(msgInbound, ctxFor({ phase: 2, chunkOrder: 99, progress: 100 }))
    expect(again.outcome).toBe('duplicate')

    expect(await db('inbox_messages').where({ externalId: msgInbound.externalId }).count()).toEqual([{ count: '1' }])
    expect(await conversationState(convLead)).toEqual(before)
    // Crucially the marker was NOT re-merged: a wamid we already hold may belong
    // to a LIVE message, and relabelling it as history would remove it from the
    // live delta and from every current-state fact.
    expect((await db('inbox_messages').where({ externalId: msgInbound.externalId }).first()).metadata).toEqual(metaBefore)
  })
})

describe('message kinds', () => {
  it('T14b: media_placeholder is recorded without pretending we have media', async () => {
    const res = await persistHistoryMessage(msgPlaceholder, ctxFor())
    expect(res.outcome).toBe('inserted')
    const r = await db('inbox_messages').where({ externalId: msgPlaceholder.externalId }).first()
    expect(r.type).toBe('unknown')
    expect(r.text).toBe('')
    expect(r.metadata.history.rawType).toBe('media_placeholder')
    expect(r.metadata.history.mediaPlaceholder).toBe(true)
  })

  it('T4b: an SMB echo (business sender, `to` present) persists as outbound', async () => {
    const res = await persistHistoryMessage(msgOutboundEcho, ctxFor())
    expect(res.outcome).toBe('inserted')
    const r = await db('inbox_messages').where({ externalId: msgOutboundEcho.externalId }).first()
    expect(r.direction).toBe('outbound')
    expect(r.toId).toBe(CUSTOMER_A)
    // No user sent this through the product; the IRE reads that column.
    expect(r.sentByUserId).toBeNull()
  })

  it('T30: an unsupported type persists safely as unknown, with its payload intact', async () => {
    const odd: ParsedHistoryMessage = {
      ...msgInbound,
      externalId: 'wamid.SYNTHETIC_UNSUPPORTED_1',
      type: 'unknown',
      rawType: 'order_status_update',
      supported: false,
      text: '',
      payload: { status: 'shipped' },
    }
    expect((await persistHistoryMessage(odd, ctxFor())).outcome).toBe('inserted')
    const r = await db('inbox_messages').where({ externalId: odd.externalId }).first()
    expect(r.type).toBe('unknown')
    // No fabricated text.
    expect(r.text).toBe('')
    expect(r.payload).toEqual({ status: 'shipped' })
    expect(r.metadata.history.rawType).toBe('order_status_update')
  })

  it('T30b: a message with undeterminable direction is refused, never defaulted', async () => {
    const res = await persistHistoryMessage({ ...msgInbound, direction: null }, ctxFor())
    expect(res).toEqual({ outcome: 'skipped', reason: 'unknown_direction' })
  })
})

describe('lead association', () => {
  it('T16: a leadless conversation stays leadless', async () => {
    const before = await conversationState(convLeadless)
    const res = await persistHistoryMessage(msgThreadB, ctxFor())
    expect(res).toEqual({
      outcome: 'inserted',
      messageId: expect.any(Number),
      conversationId: convLeadless,
      leadId: null,
    })
    const r = await db('inbox_messages').where({ externalId: msgThreadB.externalId }).first()
    expect(r.leadId).toBeNull()
    expect(await conversationState(convLeadless)).toEqual(before)
  })
})

describe('missing conversation', () => {
  it('T28 (F-3): an unknown customer CREATES a leadless conversation and imports', async () => {
    // Wave 2A.2g.1 reversed this. Refusing here meant a fresh coexistence
    // onboarding — which has no conversations yet — imported nothing at all.
    const res = await persistHistoryMessage(
      { ...msgInbound, externalId: 'wamid.SYNTHETIC_ORPHAN_1', customerWaId: '15559999999', threadId: '15559999999' },
      ctxFor(),
    )
    expect(res.outcome).toBe('inserted')

    const conv = await db('inbox_conversations').where({ agencyId, customerWaId: '15559999999' }).first()
    expect(conv).toBeTruthy()
    // Born neutral, and leadless.
    expect(conv.leadId).toBeNull()
    expect(conv.unreadCount).toBe(0)
    expect(conv.messageCount).toBe(0)
    expect(conv.lastMessageAt).toBeNull()
    expect(conv.lastInboundAt).toBeNull()
    expect(conv.lastDirection).toBeNull()
    expect(conv.lastMessageText).toBeNull()
    // And no Lead was invented for the new customer.
    expect(await db('clients').where({ agencyId }).count()).toEqual([{ count: '1' }])
  })
})

describe('side-effect audit', () => {
  const src = readFileSync('lib/inbox/persistHistoryMessage.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('T24/T25/T26/T29: imports nothing that acts', () => {
    for (const forbidden of [
      'enqueueInboundAutoResponse',
      'notifyEvent',
      'emitAutomationEvent',
      'signal',
      'investigation',
      'enqueueConversationAnalysis',
      'createLeadFromWhatsappWebhook',
      'attachConversationToLead',
      'findOrCreateConversation',
      'bumpConversationOnInbound',
      'bumpConversationOnOutbound',
      'ingestWhatsappInbound',
    ]) {
      expect(src).not.toContain(forbidden)
    }
  })

  it('T29b: a history ERROR event is not persistable — it is not a message at all', () => {
    // The union makes this a type error, not a runtime check: persistHistoryMessage
    // accepts ParsedHistoryMessage only, so an error event cannot reach it.
    expect(src).not.toContain('history_error')
    expect(src).not.toContain('errors')
  })

  it('the only writes are to inbox_messages', () => {
    const tables = [...src.matchAll(/trx\('(\w+)'\)|db\('(\w+)'\)/g)].map((m) => m[1] ?? m[2])
    expect([...new Set(tables)].sort()).toEqual(['inbox_messages', 'whatsapp_connections'])
  })
})
