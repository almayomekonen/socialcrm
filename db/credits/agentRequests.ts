import type { Knex } from 'knex'
import { db } from '@/config/db'
import { founderEntitlement } from '@/db/platformEntitlements'
import { track } from '@/lib/analytics/track'
import { aiCostToMillis } from '@/lib/credits/balance'
import { AI_SETTLE_QUIET_MS, aiUsdPerCredit, isCreditEnforcedFor, isCreditsMeteringEnabled, monthlyAllowance, paidRequestHoldMillis } from '@/lib/credits/config'
import { isAiUsageLedgerEnabled } from '@/lib/flags/aiUsageLedgerFlags'
import { creditPeriodKey, insertEntry, lockWallet, walletBalance } from './ledger'

/**
 * One row per unique owner request that reaches the AI agent: the durable
 * monthly counter, the hold on purchased credits, and the audit trail.
 *
 *   ADMISSION   under one per-agency lock: the first N of the calendar month
 *               (Asia/Jerusalem) are free, then purchased credits must cover a
 *               hold, else the request is refused BEFORE any model runs. UNIQUE
 *               (agency, operation) makes every retry return the same decision.
 *   SETTLEMENT  once the operation is quiet: a paid request is debited its actual
 *               provider cost, capped at its hold, so a balance can never go
 *               negative and a request can never be debited twice. A request that
 *               made no AI call does not count at all.
 *
 * Not enforced (no flag, or a Pro agency): decisions are recorded, nothing is
 * refused and nothing is debited.
 */

const T = 'agent_requests'
const LOG = '[credits:request]'
const SHORT_NOTICE_EVERY_MS = 60 * 60_000
/** A settled-as-unused request older than this is closed even if its job never finished. */
const LOOKBACK_DAYS = 40

export type AgentRequestInput = { agencyId: number; userId: number | null; source: 'whatsapp' | 'web'; operation: { kind: string; id: string }; nowMs?: number }
export type CreditNotice = 'full' | 'short' | null
export type AgentAdmission =
  | { allowed: true; tier: 'free' | 'paid' | 'exempt' | 'unmetered' }
  | { allowed: false; reason: 'credits_required' | 'unavailable'; notice: CreditNotice }

type Row = { id: string | number; tier: string; notice: CreditNotice }

function decisionOf(row: Row): AgentAdmission {
  if (row.tier === 'blocked') return { allowed: false, reason: 'credits_required', notice: row.notice }
  if (row.tier === 'void') return { allowed: true, tier: 'unmetered' }
  return { allowed: true, tier: row.tier as 'free' | 'paid' | 'exempt' | 'unmetered' }
}

export const freeRequestsUsed = async (q: Knex | Knex.Transaction, agencyId: number, periodKey: string): Promise<number> =>
  Number((await q(T).where({ agencyId, periodKey, tier: 'free' }).count({ n: '*' }).first())?.n ?? 0)

/** Purchased credits minus what paid requests in flight may still use. */
export async function spendableMillis(q: Knex | Knex.Transaction, agencyId: number, periodKey: string): Promise<number> {
  const open = await q(T).where({ agencyId, tier: 'paid' }).whereNull('settledAt').sum({ held: 'holdMillis' }).first()
  return (await walletBalance(q, agencyId, periodKey)).availableMillis - Number(open?.held ?? 0)
}

async function noticeFor(trx: Knex.Transaction, input: AgentRequestInput, periodKey: string, nowMs: number): Promise<CreditNotice> {
  const full = await trx(T).where({ agencyId: input.agencyId, periodKey, notice: 'full' }).first('id')
  if (!full) return 'full'
  const recent = await trx(T)
    .where({ agencyId: input.agencyId, userId: input.userId })
    .whereNotNull('notice')
    .where('createdAt', '>', new Date(nowMs - SHORT_NOTICE_EVERY_MS))
    .first('id')
  return recent ? null : 'short'
}

/** Decide ONE owner request, once. Must run before any model call. */
export async function admitAgentRequest(input: AgentRequestInput): Promise<AgentAdmission> {
  if (!isCreditsMeteringEnabled()) return { allowed: true, tier: 'unmetered' }
  const nowMs = input.nowMs ?? Date.now()
  const key = { agencyId: input.agencyId, operationKind: input.operation.kind, operationId: input.operation.id }
  let plan: string | null = null
  try {
    plan = ((await db('agencies').where({ id: input.agencyId }).first('plan')) as { plan: string | null } | undefined)?.plan ?? null
    const out = await db.transaction(async (trx) => {
      await lockWallet(trx, input.agencyId)
      const existing = (await trx(T).where(key).first('id', 'tier', 'notice')) as Row | undefined
      if (existing) return { row: existing, created: false }
      const periodKey = creditPeriodKey(nowMs)
      const enforced = isCreditEnforcedFor(input.agencyId, plan)
      let tier: string
      let holdMillis = 0
      let notice: CreditNotice = null
      if (await founderEntitlement(input.agencyId, input.userId, trx)) tier = 'exempt'
      else if ((await freeRequestsUsed(trx, input.agencyId, periodKey)) < monthlyAllowance()) tier = 'free'
      else if (!enforced) tier = 'unmetered'
      else if ((await spendableMillis(trx, input.agencyId, periodKey)) >= paidRequestHoldMillis()) {
        tier = 'paid'
        holdMillis = paidRequestHoldMillis()
      } else {
        tier = 'blocked'
        notice = await noticeFor(trx, input, periodKey, nowMs)
      }
      const [row] = await trx(T)
        .insert({ ...key, userId: input.userId, source: input.source, periodKey, tier, enforced, holdMillis, notice, settledAt: tier === 'blocked' ? new Date(nowMs) : null, createdAt: new Date(nowMs) })
        .returning(['id', 'tier', 'notice'])
      return { row: row as Row, created: true }
    })
    if (out.created && out.row.tier === 'blocked') {
      console.info(`${LOG} blocked`, { agencyId: input.agencyId, requestId: Number(out.row.id), source: input.source, notice: out.row.notice })
      await track({ agencyId: input.agencyId, userId: input.userId ?? undefined, event: out.row.notice === 'full' ? 'agent_free_allowance_exhausted' : 'agent_request_blocked', props: { source: input.source } })
    }
    return decisionOf(out.row)
  } catch (err) {
    console.error(`${LOG} admission failed`, { agencyId: input.agencyId, code: (err as { code?: string })?.code ?? null })
    // No proof of an allowance or a balance: an enforced agency's paid work does not run.
    return isCreditEnforcedFor(input.agencyId, plan) ? { allowed: false, reason: 'unavailable', notice: null } : { allowed: true, tier: 'unmetered' }
  }
}

/** The owner's own latest WhatsApp request that was refused in the last day, to offer as a draft. Never re-run. */
export async function lastBlockedQuestion(agencyId: number, userId: number, nowMs = Date.now()): Promise<string | null> {
  const row = (await db(`${T} as r`)
    .join('wa_assistant_jobs as j', db.raw('j.id::text = r."operationId"'))
    .where({ 'r.agencyId': agencyId, 'r.userId': userId, 'r.tier': 'blocked', 'r.operationKind': 'wa_assistant_job', 'j.agencyId': agencyId })
    .where('r.createdAt', '>', new Date(nowMs - 86_400_000))
    .orderBy('r.id', 'desc')
    .first('j.question')) as { question: string | null } | undefined
  return row?.question?.trim().slice(0, 300) || null
}

export type SettlementSummary = { settled: number; exempt: number; unpriced: number; voided: number; skipped: number }

type Aggregate = { calls: number; cost: number | null; unpriced: boolean; last: Date | null; models: string[] }

async function aggregate(trx: Knex.Transaction, r: { agencyId: number; operationKind: string; operationId: string }, nowMs: number): Promise<Aggregate> {
  const res = await trx.raw(
    `SELECT count(*)::int AS calls, sum("costUsd") AS cost, max("createdAt") AS last,
            bool_or(status = 'success' AND "costUsd" IS NULL) AS unpriced,
            array_agg(DISTINCT COALESCE("responseModel", "requestedModel")) AS models
       FROM ai_usage_events
      WHERE "agencyId" = ? AND "operationKind" = ? AND "operationId" = ? AND "createdAt" >= ?`,
    [r.agencyId, r.operationKind, r.operationId, new Date(nowMs - LOOKBACK_DAYS * 86_400_000)],
  )
  const a = res.rows[0]
  return { calls: Number(a.calls), cost: a.cost === null ? null : Number(a.cost), unpriced: a.unpriced === true, last: a.last ? new Date(a.last) : null, models: (a.models ?? []).filter(Boolean) }
}

/** Close quiet requests. Idempotent: each row closes once and every ledger key is unique. */
export async function settleAgentRequests(input: { nowMs?: number; limit?: number } = {}): Promise<SettlementSummary> {
  const summary: SettlementSummary = { settled: 0, exempt: 0, unpriced: 0, voided: 0, skipped: 0 }
  if (!isCreditsMeteringEnabled()) return summary
  const nowMs = input.nowMs ?? Date.now()
  const quietBefore = nowMs - AI_SETTLE_QUIET_MS
  const open = (await db(T).whereNull('settledAt').where('createdAt', '<', new Date(quietBefore)).orderBy('createdAt').limit(input.limit ?? 200).select('id', 'agencyId')) as { id: string | number; agencyId: number }[]
  for (const { id, agencyId } of open) {
    try {
      const outcome = await db.transaction(async (trx) => {
        await lockWallet(trx, agencyId)
        const r = (await trx(T).where({ id }).whereNull('settledAt').forUpdate().first()) as Record<string, any> | undefined
        if (!r) return 'skipped' as const
        const a = await aggregate(trx, { agencyId, operationKind: r.operationKind, operationId: r.operationId }, nowMs)
        if (a.last && a.last.getTime() >= quietBefore) return 'skipped' as const
        const close = (extra: Record<string, unknown>) =>
          trx(T).where({ id }).update({ settledAt: new Date(nowMs), calls: a.calls, unpriced: a.unpriced, costMicros: a.cost === null ? null : Math.round(a.cost * 1_000_000), ...extra })
        // No model call was made (refused, crashed first): it is not a request that happened.
        if (a.calls === 0 && isAiUsageLedgerEnabled() && r.tier !== 'exempt') {
          await close({ tier: 'void' })
          return 'voided' as const
        }
        const base = { agencyId, periodKey: r.periodKey as string, idempotencyKey: `request:${id}`, sourceKind: 'agent_request' as const, sourceId: String(id), userId: r.userId as number | null, costMicros: a.cost === null ? null : Math.round(a.cost * 1_000_000), meta: { calls: a.calls, models: a.models, unpriced: a.unpriced, operation: r.operationKind } }
        if (r.tier === 'exempt') {
          await insertEntry(trx, { ...base, entryType: 'exempt_debit', amountMillis: 0 })
          await close({})
          return 'exempt' as const
        }
        if (r.tier === 'paid') {
          const actual = aiCostToMillis(a.cost, aiUsdPerCredit())
          const charged = Math.min(actual, Number(r.holdMillis))
          await insertEntry(trx, { ...base, entryType: 'debit', amountMillis: -charged, enforced: true, meta: { ...base.meta, absorbedMillis: actual - charged } })
          await close({ debitMillis: charged })
          return a.unpriced ? ('unpriced' as const) : ('settled' as const)
        }
        await close({})
        return 'settled' as const
      })
      summary[outcome]++
    } catch (err) {
      summary.skipped++
      console.error(`${LOG} settlement failed`, { requestId: Number(id), code: (err as { code?: string })?.code ?? null })
    }
  }
  if (summary.unpriced) console.warn(`${LOG} paid requests settled without a provider-reported cost`, { count: summary.unpriced })
  return summary
}
