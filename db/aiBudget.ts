import type { Knex } from 'knex'
import { db } from '@/config/db'
import type { BudgetPolicy } from '@/lib/ai/budget/policy'
import type { BudgetEstimate } from '@/lib/ai/budget/estimate'
import { scopeRef, scopesFor } from '@/lib/ai/budget/scopes'
import { emitBudgetEvent, failureReason } from '@/lib/ai/budget/events'

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
 * Every settlement records HOW its actual was established (`actualCostBasis`):
 * an estimated actual is never stored as if it were provider-reported, and an
 * unknown one never carries an amount (also a CHECK in the schema).
 *
 * Which counters a request touches (and why some are skipped) is pure logic
 * in `lib/ai/budget/scopes.ts`; this file holds only the three transactions.
 *
 * NOTE: ~285 lines, over the 250 soft limit, intentionally: reserve, settle
 * and expire-and-recover share one locking protocol (one reservation row, then
 * its counters in sorted order) and one settlement statement; splitting them
 * would spread that protocol across files. The next addition belongs in a
 * sibling module, not here.
 */

const R = 'ai_budget_reservations'
const C = 'ai_budget_counters'

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
  /** The price table the estimate used; null for an unbounded (policy-reserve) estimate. */
  estimatePriceVersion?: string | null
  /** The usage ledger's invocation id, so the reservation links to its rows with or without the ledger. */
  invocationId?: string | null
  now: Date
}

export type ShadowDecision = {
  decision: 'would_allow' | 'would_deny'
  denyReasons: string[]
  warnScopes: string[]
  scopesSkipped: string[]
  created: boolean
}

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
        estimatePriceVersion: i.estimatePriceVersion ?? null,
        invocationId: i.invocationId ?? null,
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
    // A per-run limit cannot be applied to a request with no run identity.
    if (!i.operationId && i.policy.perRunUsd != null) deny.push('run_identity_missing')

    const decision = deny.length ? 'would_deny' : 'would_allow'
    await trx(R).where({ callId: i.callId }).update({ decision, denyReasons: deny, warnScopes: warn })
    return { decision, denyReasons: deny, warnScopes: warn, scopesSkipped: skipped, created: true }
  })
}

export type CostBasis = 'reported_usage' | 'estimated' | 'unknown'

export type SettleInput = {
  callId: string
  outcome: 'success' | 'error'
  actualUsd: number | null
  /** How `actualUsd` was established. Required: an amount is never stored without it. */
  costBasis: CostBasis
  costNote?: string | null
  priceVersion?: string | null
  responseModels?: string[] | null
  /** The ledger rows this settlement covers: stepIndex in [stepIndexFrom, stepIndexFrom + stepCount). */
  stepIndexFrom?: number | null
  stepCount?: number | null
}

type Settlement = Omit<SettleInput, 'callId' | 'outcome'>

/** Unknown never carries an amount; a missing or non-finite amount is unknown. */
function normalised(s: Settlement): Settlement {
  const finite = s.actualUsd != null && Number.isFinite(s.actualUsd) && s.actualUsd >= 0
  if (s.costBasis === 'unknown' || !finite) {
    return { ...s, actualUsd: null, costBasis: 'unknown', costNote: s.costNote ?? (finite ? null : 'amount_missing') }
  }
  return s
}

async function settleRow(
  trx: Knex.Transaction,
  callId: string,
  state: 'reconciled' | 'failed' | 'unknown_cost' | 'expired',
  settlement: Settlement,
): Promise<boolean> {
  const s = normalised(settlement)
  const rows = (
    await trx.raw(
      `UPDATE ${R} SET state = ?, "actualUsd" = ?, "chargedUsd" = COALESCE(?::numeric, "estimateUsd"),
              "actualCostBasis" = ?, "actualCostNote" = ?, "actualPriceVersion" = ?,
              "responseModels" = ?, "stepIndexFrom" = ?, "stepCount" = ?, "settledAt" = now()
      WHERE "callId" = ? AND state = 'reserved'
      RETURNING "estimateUsd"::float AS est, "chargedUsd"::float AS charged, "scopeKeys"`,
      [
        state,
        s.actualUsd,
        s.actualUsd,
        s.costBasis,
        s.costNote ? String(s.costNote).slice(0, 500) : null,
        s.priceVersion ?? null,
        s.responseModels?.length ? s.responseModels.map((m) => String(m).slice(0, 120)) : null,
        s.stepIndexFrom ?? null,
        s.stepCount ?? null,
        callId,
      ],
    )
  ).rows as { est: number; charged: number; scopeKeys: string[] }[]
  const actualUsd = s.actualUsd
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
  const { callId, outcome, ...settlement } = i
  const known = normalised(settlement).actualUsd != null
  const state = outcome === 'success' ? (known ? 'reconciled' : 'unknown_cost') : 'failed'
  return db.transaction((trx) => settleRow(trx, callId, state, settlement))
}

type LedgerRow = {
  callId: string
  status: string
  costUsd: string | null
  costBasis: CostBasis
  costNote: string | null
  priceVersion: string | null
  responseModel: string | null
  stepIndex: number
}

/**
 * Recovery for reservations nobody settled (a crash, a timeout, a database
 * outage longer than the settle retries).
 *
 * ONE TRANSACTION PER RESERVATION. Each one locks exactly what a settlement
 * locks — its own reservation row, then its counters in sorted order — so it
 * cannot form a lock cycle with a concurrent reservation or settlement (which
 * take counters in the same order). A sweep that settled many rows in one
 * transaction accumulated counter locks across rows in no global order and
 * could deadlock (40P01) with live reservations.
 *
 * Idempotent and race-safe: the row is re-checked FOR UPDATE SKIP LOCKED (a
 * concurrent settle or sweep owns it — skip) and every write is guarded on
 * state = 'reserved'. A failing row rolls back alone, stays `reserved` for the
 * next sweep, and is reported (`expiry_failed`); the other rows are unaffected.
 *
 *   - a usage-ledger row with the SAME callId (a router attempt, a
 *     transcription) is the very verdict the settlement would have written:
 *     the reservation is settled from it, noted `recovered_from_ledger`;
 *   - otherwise (ledger off, the row was never written, or an Agent call whose
 *     rows are per step) it is `expired`: basis unknown, charged its estimate.
 */
export async function expireStaleShadowReservations(now: Date, ttlMinutes: number, limit = 200): Promise<number> {
  const stale = (await db(R)
    .where({ state: 'reserved' })
    .where('reservedAt', '<', new Date(now.getTime() - ttlMinutes * 60_000))
    .orderBy('reservedAt')
    .limit(limit)
    .pluck('callId')) as string[]
  let settled = 0
  let failed = 0
  for (const callId of stale) {
    try {
      if (await db.transaction((trx) => expireOne(trx, callId))) settled++
    } catch (err) {
      failed++
      emitBudgetEvent('expiry_failed', { callId, stage: 'database', reason: failureReason(err, 'database'), error: err })
    }
  }
  if (stale.length) emitBudgetEvent('expiry_swept', { stale: stale.length, settled, failed })
  return settled
}

async function expireOne(trx: Knex.Transaction, callId: string): Promise<boolean> {
  const open = await trx(R).where({ callId, state: 'reserved' }).forUpdate().skipLocked().first('callId')
  if (!open) return false // settled meanwhile, or another settle / sweep holds it
  const row = (await trx('ai_usage_events')
    .where({ callId })
    .first('callId', 'status', 'costUsd', 'costBasis', 'costNote', 'priceVersion', 'responseModel', 'stepIndex')) as
    | LedgerRow
    | undefined
  return row
    ? settleRow(trx, callId, recoveredState(row), {
        actualUsd: row.costUsd == null ? null : Number(row.costUsd),
        costBasis: row.costBasis,
        costNote: ['recovered_from_ledger', row.costNote].filter(Boolean).join(','),
        priceVersion: row.priceVersion,
        responseModels: row.responseModel ? [row.responseModel] : null,
        stepIndexFrom: row.stepIndex,
        stepCount: 1,
      })
    : settleRow(trx, callId, 'expired', { actualUsd: null, costBasis: 'unknown', costNote: 'expired_unsettled' })
}

function recoveredState(row: LedgerRow): 'reconciled' | 'unknown_cost' | 'failed' {
  if (row.status !== 'success') return 'failed'
  return row.costUsd == null || row.costBasis === 'unknown' ? 'unknown_cost' : 'reconciled'
}
