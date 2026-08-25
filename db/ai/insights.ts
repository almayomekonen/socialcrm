import { db } from '@/config/db'
import type { AgentAnswer, EvidenceRef } from '@/lib/agent/types'

/**
 * The durable conclusion. SQL only, no policy.
 *
 * Two rules this module exists to make structural:
 *   · A conclusion's VALIDITY (`status`) and its DELIVERY (`deliveredAt`,
 *     `notificationJobId`) are separate axes. Nothing here lets a delivery
 *     outcome move a status, because the conclusion is still true whether or not
 *     we managed to tell anyone.
 *   · A terminal insight never reopens. Every transition targets
 *     `WHERE status = 'open'`, so a resolved, superseded or expired row is inert
 *     no matter how many times a sweep or a retry reaches it.
 */

export const AI_INSIGHTS_TABLE = 'ai_insights'

export type InsightStatus = 'open' | 'superseded' | 'resolved' | 'expired'
export type InsightResolvedReason = 'business_state' | 'superseded' | 'entity_gone' | 'expired'

export interface InsightRow {
  id: number
  agencyId: number
  insightKey: string
  subjectType: 'lead'
  subjectId: string
  expectation: string
  investigationId: string
  operatorUserId: number
  headline: string
  claims: AgentAnswer['claims']
  evidence: EvidenceRef[]
  reasoningChain: unknown[]
  decisionTrace: unknown[]
  status: InsightStatus
  supersededById: number | null
  resolvedReason: InsightResolvedReason | null
  notificationJobId: number | null
  deliveredAt: string | null
  closedAt: string | null
  createdAt: string
}

/**
 * The dedup identity. Deterministic business facts ONLY.
 *
 * No conclusion text, no class the model chose, no moment. A key derived from
 * what the model said would let a reworded conclusion become a "new" insight —
 * the model gaming its own deduplication by paraphrasing.
 */
export function insightKeyFor(input: { subjectType: 'lead'; subjectId: string; expectation: string }): string {
  return `${input.subjectType}:${input.subjectId}:${input.expectation}`
}

function parse<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T
    } catch {
      return fallback
    }
  }
  return v as T
}

function toRow(r: Record<string, unknown>): InsightRow {
  const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v))
  return {
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    insightKey: String(r.insightKey),
    subjectType: 'lead',
    subjectId: String(r.subjectId),
    expectation: String(r.expectation),
    investigationId: String(r.investigationId),
    operatorUserId: Number(r.operatorUserId),
    headline: String(r.headline),
    claims: parse(r.claims, [] as AgentAnswer['claims']),
    evidence: parse(r.evidence, [] as EvidenceRef[]),
    reasoningChain: parse(r.reasoningChain, [] as unknown[]),
    decisionTrace: parse(r.decisionTrace, [] as unknown[]),
    status: r.status as InsightStatus,
    supersededById: r.supersededById == null ? null : Number(r.supersededById),
    resolvedReason: (r.resolvedReason as InsightResolvedReason | null) ?? null,
    notificationJobId: r.notificationJobId == null ? null : Number(r.notificationJobId),
    deliveredAt: iso(r.deliveredAt),
    closedAt: iso(r.closedAt),
    createdAt: iso(r.createdAt) as string,
  }
}

export interface CreateInsightInput {
  agencyId: number
  subjectId: string
  expectation: string
  investigationId: string
  operatorUserId: number
  headline: string
  claims: AgentAnswer['claims']
  evidence: EvidenceRef[]
  reasoningChain: unknown[]
  decisionTrace: unknown[]
}

export type CreateInsightResult =
  | { created: true; row: InsightRow; supersededId: number | null }
  | { created: false; reason: 'duplicate_investigation' }

/**
 * Create a conclusion, superseding whatever it replaces — atomically.
 *
 * The open-unique index means a second live conclusion for one subject and
 * expectation cannot exist. So the supersede and the insert happen in ONE
 * transaction: close the incumbent, insert the successor, point the old row
 * forward. A crash between them would otherwise leave a subject with no live
 * insight and a released key.
 */
export async function createInsight(input: CreateInsightInput): Promise<CreateInsightResult> {
  const key = insightKeyFor({ subjectType: 'lead', subjectId: input.subjectId, expectation: input.expectation })

  return db.transaction(async (trx) => {
    const existing = (await trx('ai_insights')
      .where({ agencyId: input.agencyId, insightKey: key, status: 'open' })
      .forUpdate()
      .first()) as Record<string, unknown> | undefined

    // One row per RUN, forever. A replayed write is a no-op rather than a
    // second conclusion from the same investigation.
    const dupe = (await trx('ai_insights')
      .where({ agencyId: input.agencyId, investigationId: input.investigationId })
      .first()) as Record<string, unknown> | undefined
    if (dupe) return { created: false as const, reason: 'duplicate_investigation' as const }

    if (existing) {
      await trx('ai_insights')
        .where({ id: Number(existing.id) })
        .update({
          status: 'superseded',
          resolvedReason: 'superseded',
          closedAt: trx.fn.now(),
          updatedAt: trx.fn.now(),
        })
    }

    const res = await trx.raw(
      `INSERT INTO ai_insights
         ("agencyId","insightKey","subjectType","subjectId",expectation,"investigationId",
          "operatorUserId",headline,claims,evidence,"reasoningChain","decisionTrace",status)
       VALUES (?,?,'lead',?,?,?,?,?,?::jsonb,?::jsonb,?::jsonb,?::jsonb,'open')
       RETURNING *`,
      [
        input.agencyId,
        key,
        input.subjectId,
        input.expectation,
        input.investigationId,
        input.operatorUserId,
        input.headline,
        JSON.stringify(input.claims ?? []),
        JSON.stringify(input.evidence ?? []),
        JSON.stringify(input.reasoningChain ?? []),
        JSON.stringify(input.decisionTrace ?? []),
      ],
    )

    const row = toRow(res.rows[0])
    if (existing) {
      await trx('ai_insights')
        .where({ id: Number(existing.id) })
        .update({ supersededById: row.id })
    }
    return { created: true as const, row, supersededId: existing ? Number(existing.id) : null }
  })
}

/**
 * Close an open insight. Terminal states never reopen: the predicate targets
 * `status = 'open'`, so a repeated sweep is idempotent by construction.
 */
export async function closeInsight(
  id: number,
  status: Exclude<InsightStatus, 'open'>,
  reason: InsightResolvedReason,
): Promise<boolean> {
  const n = await db('ai_insights').where({ id, status: 'open' }).update({
    status,
    resolvedReason: reason,
    closedAt: db.fn.now(),
    updatedAt: db.fn.now(),
  })
  return Number(n) > 0
}

/**
 * Record that delivery was enqueued. Touches ONLY the delivery axis — `status`
 * is untouched, because being told is not the same as being true.
 */
export async function markDelivered(id: number, notificationJobId: number | null): Promise<boolean> {
  const n = await db('ai_insights')
    .where({ id })
    .whereNull('deliveredAt')
    .update({ deliveredAt: db.fn.now(), notificationJobId, updatedAt: db.fn.now() })
  return Number(n) > 0
}

/**
 * How many insights this agency has had DELIVERED on a given UTC calendar day.
 *
 * The day boundary is pinned to UTC explicitly. A bare `?::date` compared against
 * a `timestamptz` resolves at the DATABASE session's timezone — which here is
 * `Asia/Jerusalem`, not UTC — so the window silently shifted by the offset and the
 * cap counted the wrong day for part of every day. `AT TIME ZONE 'UTC'` makes the
 * boundary mean what `budgetDay()` already means, on any server, in any season.
 */
export async function deliveredCountForDay(agencyId: number, dateUtc: string): Promise<number> {
  const res = await db.raw(
    `SELECT COUNT(*)::int AS n FROM ai_insights
      WHERE "agencyId" = ? AND "deliveredAt" IS NOT NULL
        AND "deliveredAt" >= (?::date)::timestamp AT TIME ZONE 'UTC'
        AND "deliveredAt" <  ((?::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')`,
    [agencyId, dateUtc, dateUtc],
  )
  return Number(res.rows?.[0]?.n ?? 0)
}

/** Open insights, oldest first — what the resolution sweep walks. */
export async function listOpenInsights(limit = 100): Promise<InsightRow[]> {
  const rows = (await db('ai_insights').where({ status: 'open' }).orderBy('createdAt', 'asc').limit(limit)) as Record<
    string,
    unknown
  >[]
  return rows.map(toRow)
}

/** Open insights still awaiting delivery — what a later cap window can pick up. */
export async function listUndelivered(agencyId: number, limit = 25): Promise<InsightRow[]> {
  const rows = (await db('ai_insights')
    .where({ agencyId, status: 'open' })
    .whereNull('deliveredAt')
    .orderBy('createdAt', 'asc')
    .limit(limit)) as Record<string, unknown>[]
  return rows.map(toRow)
}

/** Agency-scoped inspection, newest first. */
export async function readInsights(agencyId: number, limit = 50): Promise<InsightRow[]> {
  const rows = (await db('ai_insights').where({ agencyId }).orderBy('id', 'desc').limit(limit)) as Record<string, unknown>[]
  return rows.map(toRow)
}
