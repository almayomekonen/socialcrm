import { vi } from 'vitest'
import { db } from '@/config/db'

/**
 * Fixtures for the owner-reminder database tests. Everything lives in the local
 * test database; agency 158 exists here only as a synthetic row used to prove
 * it is never allowlisted.
 */
export const PLATFORM = '1000000000001'
export const TOKEN = 'EAAG_reminder_test_token_not_real_0123456789'
export const MIN = 60_000
export const ago = (ms: number, from = Date.now()) => new Date(from - ms)

const made = { agencies: [] as number[], conversations: [] as number[] }
let seq = 0

export async function agency(name: string, id?: number): Promise<number> {
  if (id && (await db('agencies').where({ id }).first('id'))) return id
  const [a] = await db('agencies').insert({ ...(id ? { id } : {}), name, autoResponseEnabled: false, plan: 'pro' }).returning('id')
  made.agencies.push(Number(a.id))
  return Number(a.id)
}

export async function user(agencyId: number, role = 'ADMIN', extra: Record<string, unknown> = {}): Promise<number> {
  const [u] = await db('users').insert({ firstName: `R${++seq}`, lastName: 'T', role: role as never, agencyId, ...extra }).returning('id')
  return Number(u.id)
}

/**
 * An ACTIVE, verified recipient (as PR A's activation would leave it). Consent
 * defaults to reminders only (v2); the assistant's tests pass 'v3'.
 */
export async function recipient(
  agencyId: number,
  userId: number,
  digits: string,
  verifiedAt = ago(3 * 24 * 60 * MIN),
  consentTextVersion = 'v2',
): Promise<number> {
  const [r] = await db('owner_whatsapp_recipients')
    .insert({ agencyId, userId, phoneE164: `+${digits}`, status: 'active', consentAt: verifiedAt, consentTextVersion, consentSource: 'settings', verifiedAt })
    .returning('id')
  return Number(r.id)
}

export async function conversation(
  agencyId: number,
  opts: { lead?: boolean; handlerId?: number | null; leadStatus?: string; state?: string; isPersonal?: boolean; customerWaId?: string } = {},
): Promise<{ id: number; agencyId: number; leadId: number | null; customerWaId: string }> {
  let leadId: number | null = null
  if (opts.lead !== false) {
    const owner = await user(agencyId, 'AGNT')
    const [c] = await db('clients')
      .insert({ firstName: 'דנה', lastName: 'לוי', agencyId, userId: owner, createdById: owner, handlerId: opts.handlerId ?? null, status: opts.leadStatus ?? 'new' })
      .returning('id')
    leadId = Number(c.id)
  }
  const customerWaId = opts.customerWaId ?? `9725${String(10_000_000 + ++seq).slice(-8)}`
  const [cv] = await db('inbox_conversations')
    .insert({ agencyId, leadId, channel: 'whatsapp', businessPhoneNumberId: `__owr_pn_${agencyId}`, customerWaId, isPersonal: opts.isPersonal ?? false, state: opts.state ?? 'open', lastDirection: 'inbound', lastInboundAt: new Date() })
    .returning('id')
  made.conversations.push(Number(cv.id))
  return { id: Number(cv.id), agencyId, leadId, customerWaId }
}

export async function escalate(conv: { id: number; agencyId: number }, at: Date): Promise<void> {
  await db('conversation_ai_state')
    .insert({ conversationId: conv.id, agencyId: conv.agencyId, aiState: 'escalated', escalatedAt: at, escalationReason: 'human_request' })
    .onConflict('conversationId')
    .merge({ aiState: 'escalated', escalatedAt: at })
}

/**
 * An escalation written the way production writes it: by PostgreSQL, with
 * microseconds (here `at` plus 493 µs). A JS Date can never hold this value, so
 * any code path that round-trips it through a Date fails to match it.
 */
export async function escalateWithMicros(conv: { id: number; agencyId: number }, at: Date): Promise<void> {
  await db.raw(
    `INSERT INTO conversation_ai_state ("conversationId", "agencyId", "aiState", "escalatedAt", "escalationReason")
     VALUES (?, ?, 'escalated', ?::timestamptz + interval '493 microseconds', 'human_request')
     ON CONFLICT ("conversationId") DO UPDATE SET "aiState" = 'escalated', "escalatedAt" = EXCLUDED."escalatedAt"`,
    [conv.id, conv.agencyId, at.toISOString()],
  )
}

/** PostgreSQL's exact text of a conversation's escalation timestamp. */
export async function exactEscalatedAt(conversationId: number): Promise<string> {
  const { rows } = await db.raw('SELECT "escalatedAt"::text AS e FROM conversation_ai_state WHERE "conversationId" = ?', [conversationId])
  return String(rows[0].e)
}

export async function message(conv: { id: number; agencyId: number }, m: { dir: 'inbound' | 'outbound'; at: Date; source?: string; userId?: number | null }) {
  await db('inbox_messages').insert({
    conversationId: conv.id, agencyId: conv.agencyId, channel: 'whatsapp', direction: m.dir,
    externalId: `wamid.__owr_${process.pid}_${++seq}`, text: 'x', sequence: ++seq,
    status: m.dir === 'inbound' ? 'received' : 'sent', sentByUserId: m.userId ?? null,
    metadata: m.source ? { source: m.source } : {}, channelTimestamp: m.at, createdAt: m.at,
  })
}

export type GraphCall = { url: string; body: any }

/** Mock Graph: records every call; `reply` decides each response. */
export function mockGraph(reply: (n: number) => Response | Promise<Response> = (n) => new Response(JSON.stringify({ messages: [{ id: `wamid.SENT_${n}` }] }), { status: 200 })) {
  const calls: GraphCall[] = []
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String((init as RequestInit).body ?? 'null')) })
    return reply(calls.length)
  })
  return { calls, spy }
}

export function setLiveEnv(agencyIds: number[]) {
  process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID = PLATFORM
  process.env.OWNER_WA_REMINDERS_AGENCY_IDS = agencyIds.join(',')
  process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN = TOKEN
  process.env.OWNER_WA_REMINDERS_SEND_ENABLED = '1'
}

export function clearEnv() {
  for (const k of ['PLATFORM_WHATSAPP_PHONE_NUMBER_ID', 'OWNER_WA_REMINDERS_AGENCY_IDS', 'PLATFORM_WHATSAPP_ACCESS_TOKEN', 'OWNER_WA_REMINDERS_SEND_ENABLED']) delete process.env[k]
}

/** Remove reminder rows and close every conversation a previous test created. */
export async function resetBetweenTests() {
  await db('owner_whatsapp_reminder_deliveries').del()
  await db('owner_whatsapp_reminders').del()
  await db('owner_whatsapp_message_status').del()
  await db('owner_whatsapp_recipients').del()
  await db('platform_whatsapp_inbound').del()
  if (made.conversations.length) await db('inbox_conversations').whereIn('id', made.conversations).update({ state: 'closed' })
}

export async function cleanup() {
  clearEnv()
  await resetBetweenTests()
  if (made.conversations.length) {
    await db('questionnaire_sessions').whereIn('conversationId', made.conversations).del()
    await db('conversation_ai_state').whereIn('conversationId', made.conversations).del()
    await db('inbox_messages').whereIn('conversationId', made.conversations).del()
    await db('inbox_conversations').whereIn('id', made.conversations).del()
  }
  await db('auto_response_settings').whereIn('agencyId', made.agencies).del()
  await db('clients').whereIn('agencyId', made.agencies).del()
  await db('users').whereIn('agencyId', made.agencies).del()
  await db('agencies').whereIn('id', made.agencies).del()
}

export const deliveries = () => db('owner_whatsapp_reminder_deliveries').orderBy('id')
export const sentTo = (calls: GraphCall[]) => calls.map((c) => c.body?.to)
