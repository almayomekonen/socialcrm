import 'server-only'
import { db } from '@/config/db'
import { oldestWaitingWhatsappQuery } from '@/db/inboxWaiting'
import { waitingReplySql } from '@/lib/inbox/waitingReplySql'
import { messageTimelineOrderSql } from '@/lib/inbox/messageTimeline'
import { INTEL_KIND_INTENT, INTEL_KIND_SUMMARY, INTEL_KIND_TEMPERATURE } from '@/db/conversationIntelligence'
import type { McpPrincipal } from '@/lib/mcp/scope'
import { isAdmin } from '@/types/roles'

/**
 * WhatsApp conversation readers for MCP tools (inbox_conversations is
 * WhatsApp-only; Messenger lives in its own tables and is not exposed).
 *
 * These readers return ROWS; authorization is decided by the tools through the
 * lead visibility of Task 13 (linked) or the ADMIN/GM rule (unlinked). Every
 * query is agency-scoped. Conversations a user marked personal are never
 * returned — the product keeps them out of every automated surface.
 *
 * PII: no query here selects customerWaId, businessPhoneNumberId, fromId,
 * toId, externalId, payload, rawPayload, lastMessageText or metadata objects.
 * The only metadata read is the `source` marker of a message.
 */

export type ConversationHeader = {
  id: number
  leadId: number | null
  state: string
  customerName: string | null
  lastMessageAt: Date | string | null
  lastInboundAt: Date | string | null
}

const HEADER_COLUMNS = ['id', 'leadId', 'state', 'customerName', 'lastMessageAt', 'lastInboundAt'] as const

const baseConversations = (agencyId: number) =>
  db('inbox_conversations as cv')
    .where('cv.agencyId', agencyId)
    .where('cv.channel', 'whatsapp')
    .whereRaw('cv."isPersonal" IS NOT TRUE')

export async function getConversationHeader(agencyId: number, id: number): Promise<ConversationHeader | null> {
  const row = await baseConversations(agencyId)
    .where('cv.id', id)
    .first(HEADER_COLUMNS.map((c) => `cv.${c}`))
  return (row as ConversationHeader | undefined) ?? null
}

/** Conversations of ONE lead the caller already proved visible. Most recent first. */
export async function listLeadConversations(
  agencyId: number,
  leadId: number,
  limit: number,
): Promise<{ rows: ConversationHeader[]; truncated: boolean }> {
  const rows = (await baseConversations(agencyId)
    .where('cv.leadId', leadId)
    .select(HEADER_COLUMNS.map((c) => `cv.${c}`))
    .orderByRaw('cv."lastMessageAt" DESC NULLS LAST')
    .orderBy('cv.id', 'desc')
    .limit(limit + 1)) as ConversationHeader[]
  return { rows: rows.slice(0, limit), truncated: rows.length > limit }
}

export type ConversationIntel = {
  summary: unknown
  intent: unknown
  temperature: unknown
  status: string | null
  updatedAt: Date | string | null
}

/** Stored intelligence only — never computed here. Missing kinds stay undefined. */
export async function readIntel(agencyId: number, ids: number[]): Promise<Map<number, ConversationIntel>> {
  const out = new Map<number, ConversationIntel>()
  if (ids.length === 0) return out
  const rows = (await db('conversation_intelligence')
    .where({ agencyId })
    .whereIn('conversationId', ids)
    .whereIn('kind', [INTEL_KIND_SUMMARY, INTEL_KIND_INTENT, INTEL_KIND_TEMPERATURE])
    .select('conversationId', 'kind', 'data', 'status', 'updatedAt')) as {
    conversationId: string | number
    kind: string
    data: Record<string, unknown> | null
    status: string
    updatedAt: Date | string
  }[]
  for (const r of rows) {
    const id = Number(r.conversationId)
    const cur = out.get(id) ?? { summary: undefined, intent: undefined, temperature: undefined, status: null, updatedAt: null }
    if (r.kind === INTEL_KIND_SUMMARY) {
      cur.summary = r.data?.summary
      cur.status = r.status
      cur.updatedAt = r.updatedAt
    } else if (r.kind === INTEL_KIND_INTENT) cur.intent = r.data?.intent
    else if (r.kind === INTEL_KIND_TEMPERATURE) cur.temperature = r.data?.temperature
    out.set(id, cur)
  }
  return out
}

/** The product's waiting-reply rule (lib/inbox/waitingReplySql.ts), per conversation. */
export async function waitingFlags(agencyId: number, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set()
  const rows = await db('inbox_conversations as cv')
    .where('cv.agencyId', agencyId)
    .whereIn('cv.id', ids)
    .whereRaw(waitingReplySql('cv'))
    .select('cv.id')
  return new Set(rows.map((r: { id: string | number }) => Number(r.id)))
}

export type McpMessageRow = {
  id: number
  direction: 'inbound' | 'outbound'
  type: string
  text: string | null
  occurredAt: Date | string
  source: string | null
}

/** The newest `limit` messages, returned oldest-first; +1 row tells whether more exist. */
export async function listMessagesForMcp(
  agencyId: number,
  conversationId: number,
  limit: number,
): Promise<{ rows: McpMessageRow[]; truncated: boolean }> {
  const rows = (await db('inbox_messages as m')
    .where('m.agencyId', agencyId)
    .where('m.conversationId', conversationId)
    .select(
      'm.id',
      'm.direction',
      'm.type',
      'm.text',
      db.raw('COALESCE(m."channelTimestamp", m."createdAt") AS "occurredAt"'),
      db.raw(`m.metadata->>'source' AS source`),
    )
    .orderByRaw(messageTimelineOrderSql('m', 'desc'))
    .limit(limit + 1)) as McpMessageRow[]
  return { rows: rows.slice(0, limit).reverse(), truncated: rows.length > limit }
}

export type UnansweredRow = { conversationId: number; leadId: number | null; lastInboundAt: Date | string }

/**
 * Waiting-for-a-person threads, oldest-waiting first.
 *
 * Linked: the product's own `oldestWaitingWhatsappQuery` (the Today/inbox rule:
 * open, lead=true, not closed/lost, gotPermIds, free-plan overQuota, the
 * waiting-reply predicate). It selects lead phone/name internally; it is used
 * only as a subquery here, so neither column ever leaves the database.
 * Unlinked: ADMIN/GM only, the same waiting-reply predicate on open threads.
 */
export async function listUnanswered(
  p: McpPrincipal,
  o: { minWaitingHours: number; intent?: string; limit: number },
): Promise<{ rows: UnansweredRow[]; truncated: boolean }> {
  const cutoff = db.raw('NOW() - make_interval(hours => ?)', [o.minWaitingHours])
  const intentExists = (alias: string) => (q: ReturnType<typeof db>) =>
    q
      .select(db.raw('1'))
      .from('conversation_intelligence as ci')
      .whereRaw(`ci."conversationId" = ${alias}."conversationId"`)
      .where('ci.agencyId', p.agencyId)
      .where('ci.kind', INTEL_KIND_INTENT)
      .whereRaw(`ci.data->>'intent' = ?`, [o.intent])

  const linked = db
    .from(
      oldestWaitingWhatsappQuery({ agencyId: p.agencyId, user: { role: p.role }, gotPermIds: p.gotPermIds, plan: p.plan })
        .whereRaw('cv."isPersonal" IS NOT TRUE')
        .as('w'),
    )
    .where('w.lastInboundAt', '<=', cutoff)
    .select('w.conversationId', 'w.leadId', 'w.lastInboundAt')
  if (o.intent) linked.whereExists(intentExists('w'))

  const parts = [
    linked
      .orderBy('w.lastInboundAt', 'asc')
      .orderBy('w.conversationId', 'asc')
      .limit(o.limit + 1),
  ]

  if (isAdmin(p.role)) {
    const unlinked = db
      .from(
        baseConversations(p.agencyId)
          .whereNull('cv.leadId')
          .where('cv.state', 'open')
          .whereRaw(waitingReplySql('cv'))
          .select('cv.id as conversationId', 'cv.leadId', 'cv.lastInboundAt')
          .as('u'),
      )
      .where('u.lastInboundAt', '<=', cutoff)
      .select('u.conversationId', 'u.leadId', 'u.lastInboundAt')
    if (o.intent) unlinked.whereExists(intentExists('u'))
    parts.push(
      unlinked
        .orderBy('u.lastInboundAt', 'asc')
        .orderBy('u.conversationId', 'asc')
        .limit(o.limit + 1),
    )
  }

  const merged = ((await Promise.all(parts)) as UnansweredRow[][])
    .flat()
    .map((r) => ({ ...r, conversationId: Number(r.conversationId), leadId: r.leadId == null ? null : Number(r.leadId) }))
    .sort(
      (a, b) => new Date(a.lastInboundAt).getTime() - new Date(b.lastInboundAt).getTime() || a.conversationId - b.conversationId,
    )
  return { rows: merged.slice(0, o.limit), truncated: merged.length > o.limit }
}
