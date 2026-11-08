import { db } from '@/config/db'
import { aiUsageCategory, type AiUsageCategory } from '@/lib/credits/aiCategories'
import { automationMonthlyUsdAlert } from '@/lib/credits/config'
import { BUSINESS_TZ } from '@/lib/today/constants'

/**
 * INTERNAL measurement for one business month, READ ONLY, never shown to
 * customers. The four things kept apart:
 *
 *   agent        owner-initiated AI cost
 *   automation   background AI cost (auto-replies, analysis, generated summaries)
 *   whatsapp     Meta delivery cost of reminders, at the verified rate card. It
 *                is an upper bound: Meta's free monthly tier is not applied.
 *   founderExempt  agent operations recorded at zero for agency 103 / user 332
 *
 * `unknownCostCalls` are successful calls with no reported cost; their cost is
 * MISSING, not zero, and `reliable` is false whenever any exist or any kind is
 * unclassified.
 */

export type CategoryTotals = { calls: number; costUsd: number; unknownCostCalls: number; estimatedCostCalls: number }
export type MeasurementReport = {
  periodKey: string
  agent: CategoryTotals
  automation: CategoryTotals & { alertUsd: number | null; overAlert: boolean }
  unclassified: CategoryTotals & { kinds: string[] }
  founderExempt: { operations: number; costUsd: number }
  creditsDebited: number
  requests: Record<'free' | 'paid' | 'exempt' | 'unmetered' | 'blocked' | 'void', number>
  whatsapp: { reminders: number; rateCardUsd: number; unknownOutcome: number; missingPrice: number }
  reliable: boolean
}

const empty = (): CategoryTotals => ({ calls: 0, costUsd: 0, unknownCostCalls: 0, estimatedCostCalls: 0 })
const month = (col: string) => `to_char((${col} AT TIME ZONE '${BUSINESS_TZ}'), 'YYYY-MM') = ?`

export async function creditsMeasurementReport(periodKey: string): Promise<MeasurementReport> {
  const [ai, ledger, reminders, requests] = await Promise.all([
    db.raw(
      `SELECT "operationKind" AS kind, count(*)::int AS calls, COALESCE(sum("costUsd"), 0)::float AS usd,
              count(*) FILTER (WHERE status = 'success' AND "costUsd" IS NULL)::int AS unknown,
              count(*) FILTER (WHERE "costBasis" = 'estimated')::int AS estimated
         FROM ai_usage_events WHERE ${month('"createdAt"')} GROUP BY 1`,
      [periodKey],
    ),
    db.raw(
      `SELECT COALESCE(-sum("amountMillis") FILTER (WHERE "entryType" = 'debit'), 0)::float AS debited,
              count(*) FILTER (WHERE "entryType" = 'exempt_debit')::int AS exempt,
              COALESCE(sum("costMicros") FILTER (WHERE "entryType" = 'exempt_debit'), 0)::float AS "exemptMicros"
         FROM agency_credit_ledger WHERE "periodKey" = ?`,
      [periodKey],
    ),
    db.raw(
      `SELECT count(*) FILTER (WHERE "costReleasedAt" IS NULL AND status IN ('sent', 'dispatching', 'unknown'))::int AS reminders,
              COALESCE(sum("reservedMicros") FILTER (WHERE "costReleasedAt" IS NULL AND status IN ('sent', 'dispatching', 'unknown')), 0)::float AS micros,
              count(*) FILTER (WHERE status = 'unknown')::int AS unknown,
              count(*) FILTER (WHERE status = 'sent' AND "reservedMicros" IS NULL)::int AS missing
         FROM owner_personal_reminders WHERE "dispatchedAt" IS NOT NULL AND ${month('"dispatchedAt"')}`,
      [periodKey],
    ),
    db('agent_requests').where({ periodKey }).groupBy('tier').select('tier').count({ n: '*' }) as Promise<{ tier: string; n: string }[]>,
  ])

  const totals: Record<AiUsageCategory, CategoryTotals> = { agent: empty(), automation: empty(), unclassified: empty() }
  const kinds = new Set<string>()
  for (const r of ai.rows as { kind: string; calls: number; usd: number; unknown: number; estimated: number }[]) {
    const category = aiUsageCategory(r.kind)
    if (category === 'unclassified') kinds.add(r.kind)
    const t = totals[category]
    t.calls += r.calls
    t.costUsd += r.usd
    t.unknownCostCalls += r.unknown
    t.estimatedCostCalls += r.estimated
  }
  const l = ledger.rows[0]
  const w = reminders.rows[0]
  const alertUsd = automationMonthlyUsdAlert()
  return {
    periodKey,
    agent: totals.agent,
    automation: { ...totals.automation, alertUsd, overAlert: alertUsd !== null && totals.automation.costUsd >= alertUsd },
    unclassified: { ...totals.unclassified, kinds: [...kinds].sort() },
    founderExempt: { operations: l.exempt, costUsd: l.exemptMicros / 1e6 },
    creditsDebited: l.debited / 1000,
    requests: Object.fromEntries(['free', 'paid', 'exempt', 'unmetered', 'blocked', 'void'].map((t) => [t, Number(requests.find((r) => r.tier === t)?.n ?? 0)])) as MeasurementReport['requests'],
    whatsapp: { reminders: w.reminders, rateCardUsd: w.micros / 1e6, unknownOutcome: w.unknown, missingPrice: w.missing },
    reliable: totals.agent.unknownCostCalls + totals.automation.unknownCostCalls === 0 && totals.unclassified.calls === 0 && w.missing === 0,
  }
}
