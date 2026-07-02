import { db } from '@/config/db'
import { countUnreadConversationsForUser } from '@/db/inboxConversationReads'
import type { AwarenessItem } from './awareness/types'
import type {
  InboxChannel,
  InboxConversationListItem,
  InboxConversationsPage,
  InboxConversationTarget,
  InboxCursor,
  InboxListFilters,
  InboxSmartCounts,
} from './types'
import { DEFAULT_INBOX_FILTERS } from './types'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const PREVIEW_MAX = 80

const UNREAD_SQL = `(cv."lastInboundAt" IS NOT NULL AND (r."lastReadAt" IS NULL OR cv."lastInboundAt" > r."lastReadAt"))`

const TEMP_SQL = `(it.data->>'temperature')`
const INTENT_SQL = `(ii.data->>'intent')`
const ACTION_SQL = `(ia.data->>'suggestedAction')`

const TEMP_RANK_SQL = `(CASE ${TEMP_SQL} WHEN 'hot' THEN 3 WHEN 'warm' THEN 2 WHEN 'cold' THEN 1 ELSE 0 END)`
const INTENT_RANK_SQL = `(CASE ${INTENT_SQL} WHEN 'signup' THEN 7 WHEN 'pricing' THEN 6 WHEN 'demo' THEN 5 WHEN 'support' THEN 4 WHEN 'followup' THEN 3 WHEN 'information' THEN 2 WHEN 'other' THEN 1 ELSE 0 END)`
const ACTION_RANK_SQL = `(CASE ${ACTION_SQL} WHEN 'close_lead' THEN 7 WHEN 'send_quote' THEN 6 WHEN 'schedule_demo' THEN 5 WHEN 'answer_question' THEN 4 WHEN 'escalate_support' THEN 3 WHEN 'follow_up' THEN 2 WHEN 'none' THEN 1 ELSE 0 END)`

const RANK_SQL_BY_SORT: Record<string, string> = {
  temperature: TEMP_RANK_SQL,
  intent: INTENT_RANK_SQL,
  action: ACTION_RANK_SQL,
}

const toIso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null)

const truncate = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v)
  if (!s) return null
  return s.length > PREVIEW_MAX ? s.slice(0, PREVIEW_MAX - 1) + '…' : s
}

const toLikePattern = (q: string): string => `%${q.replace(/[\\%_]/g, (ch) => '\\' + ch)}%`

function inboxSelectQuery(userId: number) {
  return db('inbox_conversations as cv')
    .leftJoin('clients as c', 'c.id', 'cv.leadId')
    .leftJoin('inbox_conversation_reads as r', function () {
      this.on('r.conversationId', 'cv.id').andOnVal('r.userId', userId)
    })
    .leftJoin('conversation_intelligence as it', function () {
      this.on('it.conversationId', 'cv.id').andOnVal('it.kind', 'temperature')
    })
    .leftJoin('conversation_intelligence as ii', function () {
      this.on('ii.conversationId', 'cv.id').andOnVal('ii.kind', 'intent')
    })
    .leftJoin('conversation_intelligence as ia', function () {
      this.on('ia.conversationId', 'cv.id').andOnVal('ia.kind', 'suggested_action')
    })
    .select(
      'cv.id as conversationId',
      'cv.leadId',
      'cv.channel',
      'cv.customerName',
      'cv.customerWaId',
      'cv.lastMessageAt',
      'cv.lastInboundAt',
      'cv.lastDirection',
      'cv.lastMessageText',
      'c.name as leadName',
      'c.status as leadStatus',
      'r.lastReadAt',
      db.raw(`${TEMP_SQL} as temperature`),
      db.raw(`${INTENT_SQL} as intent`),
      db.raw(`${ACTION_SQL} as "suggestedAction"`),
    )
}

function applyInboxFilters<Q extends ReturnType<typeof inboxSelectQuery>>(q: Q, filters: InboxListFilters): Q {
  if (filters.status !== 'all') q.where('cv.state', filters.status)
  if (filters.needsReply) q.where('cv.lastDirection', 'inbound')
  if (filters.unread) q.whereRaw(UNREAD_SQL)
  switch (filters.intel) {
    case 'hot':
      q.whereRaw(`${TEMP_SQL} = 'hot'`)
      break
    case 'attention':
      q.whereRaw(`${TEMP_SQL} = 'hot'`).where('cv.lastDirection', 'inbound')
      break
    case 'pricing':
      q.whereRaw(`${INTENT_SQL} = 'pricing'`)
      break
    case 'demo':
      q.whereRaw(`${INTENT_SQL} = 'demo'`)
      break
    case 'support':
      q.whereRaw(`${INTENT_SQL} = 'support'`)
      break
    case 'escalation':
      q.whereRaw(`${ACTION_SQL} = 'escalate_support'`)
      break
    case 'followup':
      q.whereRaw(`${ACTION_SQL} = 'follow_up'`)
      break
  }
  const term = filters.q?.trim()
  if (term) {
    const pattern = toLikePattern(term)
    q.where((b) => {
      b.whereILike('c.name', pattern)
        .orWhereILike('cv.customerName', pattern)
        .orWhereILike('cv.customerWaId', pattern)
        .orWhereILike('cv.lastMessageText', pattern)
    })
  }
  return q
}

export function computeUnread(r: { lastInboundAt?: unknown; lastReadAt?: unknown }): boolean {
  const lastInboundMs = r.lastInboundAt ? new Date(r.lastInboundAt as string | Date).getTime() : null
  const lastReadMs = r.lastReadAt ? new Date(r.lastReadAt as string | Date).getTime() : null
  return lastInboundMs !== null && (lastReadMs === null || lastInboundMs > lastReadMs)
}

function mapInboxRow(r: Record<string, unknown>): InboxConversationListItem {
  const lastDirection = (r.lastDirection ?? null) as 'inbound' | 'outbound' | null
  return {
    conversationId: Number(r.conversationId),
    leadId: Number(r.leadId),
    channel: r.channel as InboxChannel,
    displayName: (r.customerName as string) || (r.leadName as string) || (r.customerWaId as string) || null,
    leadName: (r.leadName as string) ?? null,
    leadStatus: (r.leadStatus as string) ?? null,
    lastMessageAt: toIso(r.lastMessageAt),
    lastDirection,
    lastMessagePreview: truncate(r.lastMessageText),
    unread: computeUnread(r),
    attention: lastDirection === 'inbound' ? 'needs_reply' : lastDirection === 'outbound' ? 'replied' : null,
    temperature: (r.temperature as InboxConversationListItem['temperature']) ?? null,
    intent: (r.intent as InboxConversationListItem['intent']) ?? null,
    suggestedAction: (r.suggestedAction as InboxConversationListItem['suggestedAction']) ?? null,
  }
}

export async function listInboxConversations(
  agencyId: number,
  userId: number,
  opts: { cursor?: InboxCursor | null; limit?: number; filters?: Partial<InboxListFilters> } = {},
): Promise<InboxConversationsPage> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const filters: InboxListFilters = { ...DEFAULT_INBOX_FILTERS, ...opts.filters }
  const cursor = opts.cursor ?? null

  let q = inboxSelectQuery(userId)
    .where('cv.agencyId', agencyId)
    .limit(limit + 1)
  applyInboxFilters(q, filters)

  const rankSql = RANK_SQL_BY_SORT[filters.sort]
  if (rankSql) {
    q = q.select(db.raw(`${rankSql} as "sortRank"`)).orderByRaw(`${rankSql} DESC, cv."lastMessageAt" DESC, cv.id DESC`)
    if (cursor) {
      q = q.whereRaw(`(${rankSql}, cv."lastMessageAt", cv.id) < (?, ?, ?)`, [cursor.rank ?? 0, cursor.lastMessageAt, cursor.id])
    }
  } else if (filters.sort === 'oldest') {
    q = q.orderBy([
      { column: 'cv.lastMessageAt', order: 'asc' },
      { column: 'cv.id', order: 'asc' },
    ])
    if (cursor) q = q.whereRaw('(cv."lastMessageAt", cv.id) > (?, ?)', [cursor.lastMessageAt, cursor.id])
  } else if (filters.sort === 'unread') {
    q = q.orderByRaw(`${UNREAD_SQL} DESC, cv."lastMessageAt" DESC, cv.id DESC`)
    if (cursor) {
      q = q.whereRaw(`((CASE WHEN ${UNREAD_SQL} THEN 1 ELSE 0 END), cv."lastMessageAt", cv.id) < (?, ?, ?)`, [
        cursor.unread ? 1 : 0,
        cursor.lastMessageAt,
        cursor.id,
      ])
    }
  } else {
    q = q.orderBy([
      { column: 'cv.lastMessageAt', order: 'desc' },
      { column: 'cv.id', order: 'desc' },
    ])
    if (cursor) q = q.whereRaw('(cv."lastMessageAt", cv.id) < (?, ?)', [cursor.lastMessageAt, cursor.id])
  }

  const rows = await q
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows

  const items: InboxConversationListItem[] = pageRows.map(mapInboxRow)

  const last = pageRows[pageRows.length - 1]
  const lastTs = last ? toIso(last.lastMessageAt) : null
  const nextCursor: InboxCursor | null =
    hasMore && last && lastTs
      ? {
          lastMessageAt: lastTs,
          id: Number(last.conversationId),
          unread: computeUnread(last),
          ...(rankSql ? { rank: Number(last.sortRank ?? 0) } : {}),
        }
      : null

  return { items, nextCursor }
}

/** Conversations whose lastMessageAt advanced past `since` (2s overlap), in the active view. */
export async function getInboxDelta(
  agencyId: number,
  userId: number,
  sinceISO: string | null,
  filters: InboxListFilters,
): Promise<{ changed: InboxConversationListItem[]; full: boolean }> {
  const DELTA_LIMIT = 100
  const q = inboxSelectQuery(userId).where('cv.agencyId', agencyId)
  applyInboxFilters(q, filters)
  if (sinceISO) {
    q.whereRaw('cv."lastMessageAt" > ?', [new Date(new Date(sinceISO).getTime() - 2000)])
  }
  q.orderBy([
    { column: 'cv.lastMessageAt', order: 'asc' },
    { column: 'cv.id', order: 'asc' },
  ]).limit(DELTA_LIMIT + 1)
  const rows = await q
  const full = rows.length > DELTA_LIMIT
  return { changed: (full ? rows.slice(0, DELTA_LIMIT) : rows).map(mapInboxRow), full }
}

/** Global awareness: per-user unread count + recent unread arrivals (toast/bell items). */
export async function getInboxAwareness(
  agencyId: number,
  userId: number,
  sinceISO: string | null,
): Promise<{ counts: { whatsappUnread: number }; items: AwarenessItem[] }> {
  const whatsappUnread = await countUnreadConversationsForUser(agencyId, userId)
  const itemsQ = db('inbox_conversations as cv')
    .leftJoin('clients as c', 'c.id', 'cv.leadId')
    .leftJoin('inbox_conversation_reads as r', function () {
      this.on('r.conversationId', 'cv.id').andOnVal('r.userId', userId)
    })
    .where('cv.agencyId', agencyId)
    .whereRaw(UNREAD_SQL)
    .orderBy('cv.lastInboundAt', 'desc')
    .limit(20)
    .select('cv.id as conversationId', 'cv.customerName', 'cv.customerWaId', 'cv.lastInboundAt', 'c.name as leadName')
  if (sinceISO) {
    itemsQ.whereRaw('cv."lastInboundAt" > ?', [new Date(new Date(sinceISO).getTime() - 2000)])
  }
  const rows = await itemsQ
  const items: AwarenessItem[] = rows.map((r) => ({
    type: 'whatsapp_message',
    conversationId: Number(r.conversationId),
    contactName: (r.customerName || r.leadName || r.customerWaId || 'ליד') as string,
    at: toIso(r.lastInboundAt) ?? '',
  }))
  return { counts: { whatsappUnread }, items }
}

export async function getInboxSmartCounts(agencyId: number): Promise<InboxSmartCounts> {
  const rowPromise = db('inbox_conversations as cv')
    .leftJoin('conversation_intelligence as it', function () {
      this.on('it.conversationId', 'cv.id').andOnVal('it.kind', 'temperature')
    })
    .leftJoin('conversation_intelligence as ii', function () {
      this.on('ii.conversationId', 'cv.id').andOnVal('ii.kind', 'intent')
    })
    .leftJoin('conversation_intelligence as ia', function () {
      this.on('ia.conversationId', 'cv.id').andOnVal('ia.kind', 'suggested_action')
    })
    .where('cv.agencyId', agencyId)
    .andWhere('cv.state', 'open')
    .first(
      db.raw(`COUNT(*) FILTER (WHERE ${TEMP_SQL} = 'hot') as hot`),
      db.raw(`COUNT(*) FILTER (WHERE ${TEMP_SQL} = 'hot' AND cv."lastDirection" = 'inbound') as attention`),
      db.raw(`COUNT(*) FILTER (WHERE ${INTENT_SQL} = 'demo') as demo`),
      db.raw(`COUNT(*) FILTER (WHERE ${ACTION_SQL} = 'escalate_support') as escalation`),
    ) as unknown as Promise<Record<keyof InboxSmartCounts, unknown> | undefined>
  const row = await rowPromise

  return {
    hot: Number(row?.hot ?? 0),
    attention: Number(row?.attention ?? 0),
    demo: Number(row?.demo ?? 0),
    escalation: Number(row?.escalation ?? 0),
  }
}

export async function getInboxConversationById(
  agencyId: number,
  conversationId: number,
): Promise<InboxConversationTarget | null> {
  const r = await db('inbox_conversations as cv')
    .leftJoin('clients as c', 'c.id', 'cv.leadId')
    .where('cv.id', conversationId)
    .andWhere('cv.agencyId', agencyId)
    .first(
      'cv.id as conversationId',
      'cv.leadId',
      'cv.channel',
      'cv.customerName',
      'cv.customerWaId',
      'c.name as leadName',
      'c.status as leadStatus',
    )

  if (!r) return null

  return {
    conversationId: Number(r.conversationId),
    leadId: Number(r.leadId),
    channel: r.channel as InboxChannel,
    displayName: r.customerName || r.leadName || r.customerWaId || null,
    leadName: r.leadName ?? null,
    leadStatus: r.leadStatus ?? null,
    customerWaId: r.customerWaId ?? null,
  }
}
