import type { Knex } from 'knex'
import { db } from '@/config/db'
import type { BudgetPolicy } from '@/lib/ai/budget/policy'
import type { BudgetEstimate } from '@/lib/ai/budget/estimate'

/**
 * Durable AI budget reservations (ai_budget_reservations + ai_budget_counters).
 * SHADOW MODE: the decision is recorded, never acted on.
 *
 * ATOMICITY. A reservation is one transaction: the reservation row (unique
 * callId — a repeat is a no-op) and one counter upsert per scope, taken in a
 * fixed sorted order. Each upsert row-locks its counter, so concurrent
 * requests against the same scope serialise and each sees the total
 * INCLUDING everything reserved before it. No in-memory state is involved.
 *
 * SETTLEMENT is guarded on state = 'reserved' (idempotent): the estimate leaves
 * `reservedUsd` and the charged amount (actual, or the estimate when the cost
 * is unknown) enters `spentUsd`. Expiry recovers reservations nobody settled.
 */

const R = 'ai_budget_reservations'
const C = 'ai_budget_counters'
const RUN_EPOCH = new Date(0)

export type ReserveInput = {
  callId: string
  policy: BudgetPolicy
  agencyId: number | null
  operationKind: string
  operationId: string | null
  conversationId: number | null
  contactKey: string | null
  feature: string
  provider: string
  model: string
  estimate: BudgetEstimate
  now: Date
}

export type ShadowDecision = {
  decision: 'would_allow' | 'would_deny'
  denyReasons: string[]
  warnScopes: string[]
  scopesSkipped: string[]
  created: boolean
}

type Scope = {
  name: string
  key: string
  kind: 'run' | 'hour' | 'day' | 'period' | 'contact_window'
  start: Date
  limit: number | null
}

const utcHour = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()))
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
const utcMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
/** Fixed buckets of `hours` (an approximation of a rolling window, stable across instances). */
const bucket = (d: Date, hours: number) => new Date(Math.floor(d.getTime() / (hours * 3_600_000)) * hours * 3_600_000)

function scopesFor(i: ReserveInput): { scopes: Scope[]; skipped: string[] } {
  const p = i.policy
  const a = i.agencyId
  const scopes: Scope[] = []
  const skipped: string[] = []
  scopes.push({
    name: 'run',
    key: `run:a${a ?? '-'}:${i.operationKind}:${i.operationId ?? i.callId}`,
    kind: 'run',
    start: RUN_EPOCH,
    limit: p.perRunUsd,
  })
  if (i.conversationId != null)
    scopes.push({
      name: 'conversation_daily',
      key: `conv:a${a ?? '-'}:${i.conversationId}`,
      kind: 'day',
      start: utcDay(i.now),
      limit: p.conversationDailyUsd,
    })
  else skipped.push('conversation')
  if (i.contactKey)
    scopes.push({
      name: 'contact_window',
      key: `contact:${i.contactKey}`,
      kind: 'contact_window',
      start: bucket(i.now, Math.max(1, p.contactWindowHours)),
      limit: p.contactWindowUsd,
    })
  else skipped.push('contact')
  if (a != null) {
    scopes.push({ name: 'agency_hourly', key: `agency:${a}`, kind: 'hour', start: utcHour(i.now), limit: p.agencyHourlyUsd })
    scopes.push({ name: 'agency_daily', key: `agency:${a}`, kind: 'day', start: utcDay(i.now), limit: p.agencyDailyUsd })
    scopes.push({ name: 'agency_period', key: `agency:${a}`, kind: 'period', start: utcMonth(i.now), limit: p.agencyPeriodUsd })
  } else skipped.push('agency')
  scopes.push({ name: 'global_daily', key: 'global', kind: 'day', start: utcDay(i.now), limit: p.globalDailyUsd })
  scopes.sort((x, y) => (x.key + x.kind < y.key + y.kind ? -1 : 1))
  return { scopes, skipped }
}

const scopeRef = (s: Scope) => `${s.key}|${s.kind}|${s.start.toISOString()}`

export async function reserveShadow(i: ReserveInput): Promise<ShadowDecision> {
  return db.transaction(async (trx) => {
    const { scopes, skipped } = scopesFor(i)
    const inserted = await trx(R)
      .insert({
        callId: i.callId,
        policyVersion: i.policy.version,
        agencyId: i.agencyId,
        operationKind: i.operationKind,
        operationId: i.operationId,
        conversationId: i.conversationId,
        contactKey: i.contactKey,
        feature: i.feature,
        provider: i.provider,
        model: i.model,
        estimateUsd: i.estimate.usd,
        estimateBasis: i.estimate.basis,
        costMetadataIncomplete: i.estimate.incomplete,
        decision: 'would_allow',
        scopesSkipped: skipped,
        scopeKeys: scopes.map(scopeRef),
      })
      .onConflict('callId')
      .ignore()
      .returning('id')
    if (!inserted.length) {
      const prior = (await trx(R)
        .where({ callId: i.callId })
        .first('decision', 'denyReasons', 'warnScopes', 'scopesSkipped')) as Omit<ShadowDecision, 'created'>
      return { ...prior, created: false }
    }

    const deny: string[] = []
    const warn: string[] = []
    for (const s of scopes) {
      const res = await trx.raw(
        `INSERT INTO ${C} ("scopeKey","windowKind","windowStart","reservedUsd",requests)
         VALUES (?,?,?,?,1)
         ON CONFLICT ("scopeKey","windowKind","windowStart") DO UPDATE
           SET "reservedUsd" = ${C}."reservedUsd" + EXCLUDED."reservedUsd", requests = ${C}.requests + 1, "updatedAt" = now()
         RETURNING ("reservedUsd" + "spentUsd")::float AS total`,
        [s.key, s.kind, s.start, i.estimate.usd],
      )
      if (s.limit == null) continue
      // Compared in whole micro-dollars: 0.025 × 0.8 must equal 0.02 exactly.
      const micro = (usd: number) => Math.round(usd * 1e6)
      const total = micro(Number(res.rows[0].total))
      if (total > micro(s.limit)) deny.push(`${s.name}_limit`)
      else if (total >= micro(s.limit * i.policy.warnAtFraction)) warn.push(s.name)
    }
    if (i.policy.perRequestMaxUsd != null && i.estimate.usd > i.policy.perRequestMaxUsd) deny.push('request_max')
    if (i.estimate.basis === 'unbounded' && i.policy.denyUnbounded) deny.push('max_cost_unbounded')

    const decision = deny.length ? 'would_deny' : 'would_allow'
    await trx(R).where({ callId: i.callId }).update({ decision, denyReasons: deny, warnScopes: warn })
    return { decision, denyReasons: deny, warnScopes: warn, scopesSkipped: skipped, created: true }
  })
}

export type SettleInput = { callId: string; outcome: 'success' | 'error'; actualUsd: number | null; now?: Date }

async function settleRow(
  trx: Knex.Transaction,
  callId: string,
  state: 'reconciled' | 'failed' | 'unknown_cost' | 'expired',
  actualUsd: number | null,
): Promise<boolean> {
  const rows = (
    await trx.raw(
      `UPDATE ${R} SET state = ?, "actualUsd" = ?, "chargedUsd" = COALESCE(?::numeric, "estimateUsd"), "settledAt" = now()
      WHERE "callId" = ? AND state = 'reserved'
      RETURNING "estimateUsd"::float AS est, "chargedUsd"::float AS charged, "scopeKeys"`,
      [state, actualUsd, actualUsd, callId],
    )
  ).rows as { est: number; charged: number; scopeKeys: string[] }[]
  if (!rows.length) return false
  const { est, charged, scopeKeys } = rows[0]
  for (const ref of [...scopeKeys].sort()) {
    const [key, kind, start] = ref.split('|')
    await trx.raw(
      `UPDATE ${C} SET "reservedUsd" = GREATEST("reservedUsd" - ?, 0), "spentUsd" = "spentUsd" + ?,
              "unknownCostRequests" = "unknownCostRequests" + ?, "updatedAt" = now()
        WHERE "scopeKey" = ? AND "windowKind" = ? AND "windowStart" = ?`,
      [est, charged, actualUsd == null ? 1 : 0, key, kind, new Date(start)],
    )
  }
  return true
}

/** After the provider request. Idempotent: a second settle of the same callId changes nothing. */
export async function settleShadow(i: SettleInput): Promise<boolean> {
  const state = i.outcome === 'success' ? (i.actualUsd == null ? 'unknown_cost' : 'reconciled') : 'failed'
  return db.transaction((trx) => settleRow(trx, i.callId, state, i.actualUsd))
}

/** Recovery: reservations nobody settled (a worker died) are charged their estimate. Idempotent. */
export async function expireStaleShadowReservations(now: Date, ttlMinutes: number, limit = 200): Promise<number> {
  return db.transaction(async (trx) => {
    const stale = (await trx(R)
      .where({ state: 'reserved' })
      .where('reservedAt', '<', new Date(now.getTime() - ttlMinutes * 60_000))
      .orderBy('reservedAt')
      .limit(limit)
      .forUpdate()
      .skipLocked()
      .pluck('callId')) as string[]
    let n = 0
    for (const callId of stale) if (await settleRow(trx, callId, 'expired', null)) n++
    return n
  })
}
