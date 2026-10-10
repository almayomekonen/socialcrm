import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/config/db'
import { parseCustomerUserId, recordConversationCustomerUserId } from '@/lib/inbox/customerUserId'
import { handleInboundWebhookMessage } from '@/lib/whatsapp/handleInboundWebhookMessage'
import { ingestWhatsappEchoes } from '@/lib/inbox/ingestWhatsappEcho'
import { parseMessageEchoes } from '@/lib/whatsapp/parseMessageEcho'

/**
 * WhatsApp business-scoped user ID (BSUID), against a real PostgreSQL:
 * the migration, the format rule, and the id being recorded next to the
 * phone-keyed conversation by the REAL inbound and echo paths, without merging
 * or overwriting anything and without changing how conversations are found.
 */

const MIGRATION = require(path.join(process.cwd(), 'migrations/20261010120000_inbox_conversations_customer_user_id.cjs'))
const PN_A = '__bsuid_pn_a'
const PN_B = '__bsuid_pn_b'
const U1 = 'IL.13491208655302741918'
const U2 = 'IL.99990000111122223333'
const agencies: number[] = []
let agencyA: number
let agencyB: number

async function agency(name: string, pn: string): Promise<number> {
  const [a] = await db('agencies').insert({ name, autoResponseEnabled: false, plan: 'pro' }).returning('id')
  const id = Number(a.id)
  agencies.push(id)
  const [u] = await db('users').insert({ firstName: 'B', role: 'ADMIN', agencyId: id }).returning('id')
  await db('whatsapp_connections').insert({ user_id: u.id, agency_id: id, phone_number_id: pn, access_token: 'x' })
  return id
}
const conversation = (agencyId: number, pn: string, wa: string) =>
  db('inbox_conversations').insert({ agencyId, channel: 'whatsapp', businessPhoneNumberId: pn, customerWaId: wa }).returning('id').then((r) => Number(r[0].id))
const userIdOf = async (id: number) => (await db('inbox_conversations').where({ id }).first('customerUserId'))?.customerUserId ?? null

beforeAll(async () => {
  process.env.WA_CONTACTS_ENABLED = '1'
  process.env.WA_CONTACTS_AGENCY_ALLOWLIST = 'all'
  agencyA = await agency('__test_bsuid_a__', PN_A)
  agencyB = await agency('__test_bsuid_b__', PN_B)
})

afterAll(async () => {
  for (const k of ['WA_CONTACTS_ENABLED', 'WA_CONTACTS_AGENCY_ALLOWLIST']) delete process.env[k]
  for (const t of ['notification_jobs', 'notifications', 'analytics_events', 'auto_response_jobs', 'conversation_analysis_jobs', 'conversation_ai_state', 'inbox_messages', 'inbox_participants', 'inbox_conversations']) {
    const cols = await db(t).columnInfo().catch(() => ({}))
    if ('agencyId' in cols) await db(t).whereIn('agencyId', agencies).del()
  }
  await db('clients').whereIn('agencyId', agencies).del()
  await db('whatsapp_connections').whereIn('agency_id', agencies).del()
  await db('users').whereIn('agencyId', agencies).del()
  await db('agencies').whereIn('id', agencies).del()
})

describe('migration', () => {
  const state = async () => ({
    column: (await db.raw(`SELECT 1 FROM information_schema.columns WHERE table_name='inbox_conversations' AND column_name='customerUserId'`)).rows.length === 1,
    index: (await db.raw(`SELECT indexdef FROM pg_indexes WHERE indexname='inbox_conversations_customer_user_id_uniq'`)).rows[0]?.indexdef ?? null,
  })

  it('adds a nullable column and a partial unique index scoped by channel and business number', async () => {
    const s = await state()
    expect(s.column).toBe(true)
    expect(s.index).toContain('UNIQUE')
    expect(s.index).toContain('(channel, "businessPhoneNumberId", "customerUserId")')
    expect(s.index).toContain('WHERE ("customerUserId" IS NOT NULL)')
  })

  it('is reversible: down removes both, up restores both, and existing conversations survive', async () => {
    const keep = await conversation(agencyA, PN_A, '972500000901')
    await MIGRATION.down(db)
    expect(await state()).toEqual({ column: false, index: null })
    await MIGRATION.up(db)
    const s = await state()
    expect(s.column).toBe(true)
    expect(s.index).not.toBeNull()
    expect(await userIdOf(keep)).toBeNull()
  })

  it('the CHECK accepts the documented format and rejects anything else', async () => {
    const id = await conversation(agencyA, PN_A, '972500000902')
    for (const bad of ['13491208655302741918', 'il.1349', 'US.ENT.11815799212886844830', 'US.', `US.${'a'.repeat(129)}`, 'US 1349']) {
      await expect(db('inbox_conversations').where({ id }).update({ customerUserId: bad })).rejects.toThrow()
    }
    await db('inbox_conversations').where({ id }).update({ customerUserId: 'US.13491208655302741918' })
    expect(await userIdOf(id)).toBe('US.13491208655302741918')
  })
})

describe('ID validation', () => {
  it('accepts only the documented shape, exactly as sent', () => {
    expect(parseCustomerUserId(U1)).toBe(U1)
    for (const bad of [null, undefined, 5, '', ' IL.1349', 'IL.1349 ', 'il.1349', 'IL1349', 'IL.ENT.1349', 'IL.13-49']) expect(parseCustomerUserId(bad)).toBeNull()
  })
})

describe('recording the id on a conversation', () => {
  it('records once; recording again is a no-op', async () => {
    const id = await conversation(agencyA, PN_A, '972500000911')
    const key = { agencyId: agencyA, businessPhoneNumberId: PN_A, customerWaId: '972500000911' }
    expect(await recordConversationCustomerUserId({ ...key, customerUserId: U1 })).toBe('recorded')
    expect(await recordConversationCustomerUserId({ ...key, customerUserId: U1 })).toBe('unchanged')
    expect(await userIdOf(id)).toBe(U1)
  })

  it('never overwrites a different id on the same conversation', async () => {
    const id = await conversation(agencyA, PN_A, '972500000912')
    const key = { agencyId: agencyA, businessPhoneNumberId: PN_A, customerWaId: '972500000912' }
    expect(await recordConversationCustomerUserId({ ...key, customerUserId: U2 })).toBe('recorded')
    expect(await recordConversationCustomerUserId({ ...key, customerUserId: 'IL.55556666777788889999' })).toBe('conflict')
    expect(await userIdOf(id)).toBe(U2)
  })

  it('never gives one id to two conversations on the same business number (no merge)', async () => {
    const other = await conversation(agencyA, PN_A, '972500000913')
    expect(await recordConversationCustomerUserId({ agencyId: agencyA, businessPhoneNumberId: PN_A, customerWaId: '972500000913', customerUserId: U1 })).toBe('conflict')
    expect(await userIdOf(other)).toBeNull()
  })

  it('tenant isolation: the same id on another agency and business number is a separate record', async () => {
    const b = await conversation(agencyB, PN_B, '972500000911')
    expect(await recordConversationCustomerUserId({ agencyId: agencyB, businessPhoneNumberId: PN_B, customerWaId: '972500000911', customerUserId: U1 })).toBe('recorded')
    expect(await userIdOf(b)).toBe(U1)
    // The wrong agency for a business number finds nothing and writes nothing.
    expect(await recordConversationCustomerUserId({ agencyId: agencyB, businessPhoneNumberId: PN_A, customerWaId: '972500000914', customerUserId: U2 })).toBe('no_conversation')
  })

  it('an invalid id writes nothing', async () => {
    const id = await conversation(agencyA, PN_A, '972500000915')
    expect(await recordConversationCustomerUserId({ agencyId: agencyA, businessPhoneNumberId: PN_A, customerWaId: '972500000915', customerUserId: 'not-an-id' })).toBe('invalid')
    expect(await userIdOf(id)).toBeNull()
  })
})

describe('the real inbound path', () => {
  const connection = () => ({ agency_id: agencyA, user_id: 0 })
  const inbound = (wa: string, wamid: string, userId?: string) => ({
    message: { from: wa, id: wamid, timestamp: '1760000000', type: 'text', text: { body: 'שלום' }, ...(userId ? { from_user_id: userId } : {}) },
    phoneNumberId: PN_A,
    profileName: 'בדיקה',
    connection: connection(),
  })
  const convFor = (wa: string) => db('inbox_conversations').where({ agencyId: agencyA, businessPhoneNumberId: PN_A, customerWaId: wa }).first('id', 'customerUserId')

  it('stores the message as before and records from_user_id on its conversation; a redelivery changes nothing', async () => {
    const userId = 'IL.10000000000000000021'
    await handleInboundWebhookMessage(inbound('972500000921', 'wamid.__bsuid_in_1', userId) as never)
    const conv = await convFor('972500000921')
    expect(conv.customerUserId).toBe(userId)
    const before = await db('inbox_messages').where({ conversationId: conv.id }).count<{ count: string }>('id as count').first()
    await handleInboundWebhookMessage(inbound('972500000921', 'wamid.__bsuid_in_1', userId) as never)
    const after = await db('inbox_messages').where({ conversationId: conv.id }).count<{ count: string }>('id as count').first()
    expect(after?.count).toBe(before?.count)
    expect((await convFor('972500000921')).customerUserId).toBe(userId)
  })

  it('a message without from_user_id leaves the column empty, and the conversation is still keyed by phone', async () => {
    await handleInboundWebhookMessage(inbound('972500000922', 'wamid.__bsuid_in_2') as never)
    const conv = await convFor('972500000922')
    expect(conv).toBeTruthy()
    expect(conv.customerUserId).toBeNull()
  })

  it('a malformed from_user_id is ignored; the message is still stored', async () => {
    await handleInboundWebhookMessage(inbound('972500000923', 'wamid.__bsuid_in_3', 'bogus') as never)
    const conv = await convFor('972500000923')
    expect(conv.customerUserId).toBeNull()
    expect(await db('inbox_messages').where({ conversationId: conv.id, externalId: 'wamid.__bsuid_in_3' }).first('id')).toBeTruthy()
  })
})

describe('the real Coexistence echo path', () => {
  const echoValue = (to: string, id: string, toUserId?: string) => ({
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '972300000000', phone_number_id: PN_A },
    message_echoes: [{ from: '972300000000', to, id, timestamp: '1760000000', type: 'text', text: { body: 'תשובה' }, ...(toUserId ? { to_user_id: toUserId } : {}) }],
  })

  it('the parser carries to_user_id exactly as sent', () => {
    expect(parseMessageEchoes(echoValue('972500000931', 'wamid.x', U1))[0].customerUserId).toBe(U1)
    expect(parseMessageEchoes(echoValue('972500000931', 'wamid.y'))[0].customerUserId).toBeNull()
  })

  it('records to_user_id on the echo conversation; a redelivery changes nothing', async () => {
    const userId = 'IL.10000000000000000031'
    expect((await ingestWhatsappEchoes(echoValue('972500000931', 'wamid.__bsuid_echo_1', userId))).persisted).toBe(1)
    const conv = await db('inbox_conversations').where({ agencyId: agencyA, businessPhoneNumberId: PN_A, customerWaId: '972500000931' }).first('id', 'customerUserId')
    expect(conv.customerUserId).toBe(userId)
    expect((await ingestWhatsappEchoes(echoValue('972500000931', 'wamid.__bsuid_echo_1', userId))).duplicates).toBe(1)
    expect(await db('inbox_messages').where({ conversationId: conv.id }).count<{ count: string }>('id as count').first()).toEqual({ count: '1' })
  })

  it('an echo without "to" is still dropped, exactly as before (phone-less support is a later PR)', async () => {
    const result = await ingestWhatsappEchoes({
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: PN_A },
      message_echoes: [{ from: '972300000000', to_user_id: U2, id: 'wamid.__bsuid_echo_nophone', timestamp: '1760000000', type: 'text', text: { body: 'x' } }],
    })
    expect(result.persisted).toBe(0)
    expect(await db('inbox_messages').where({ externalId: 'wamid.__bsuid_echo_nophone' }).first('id')).toBeUndefined()
  })
})
