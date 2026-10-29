/**
 * AI budget policy — SERVER-SIDE configuration for the shadow evaluator.
 *
 * AI_BUDGET_SHADOW=1 turns shadow evaluation on (absence blocks).
 * AI_BUDGET_POLICY  optional JSON (`BudgetPolicyInput`); unset → the local
 *   default below, which sets NO LIMITS: every request is recorded with its
 *   estimate and `would_allow`. Production values are a separate decision and
 *   are deliberately not chosen here. Invalid JSON falls back to the default
 *   and is logged (never thrown into an AI call).
 *
 * Limits are USD. `null` = no limit at that scope. `agencyOverrides` replaces
 * fields for one agency only (tenant-isolated; keyed by the server-derived
 * agency id, never by anything a client sends).
 */

export type BudgetLimits = {
  /** Max estimated cost of ONE provider request. */
  perRequestMaxUsd: number | null
  /** Max total for one business operation (e.g. one auto-response job, one Agent run). */
  perRunUsd: number | null
  /** Per conversation per UTC day. */
  conversationDailyUsd: number | null
  /** Per contact (hashed) over a rolling window of `contactWindowHours`. */
  contactWindowUsd: number | null
  contactWindowHours: number
  agencyHourlyUsd: number | null
  agencyDailyUsd: number | null
  /** Per agency per billing period (provisional: UTC calendar month; Stage 3 maps it to the subscription period). */
  agencyPeriodUsd: number | null
  /** The global circuit breaker, per UTC day across all agencies. */
  globalDailyUsd: number | null
  /** Fraction of a limit at which a scope is recorded in `warnScopes`. */
  warnAtFraction: number
  /** Reserved when a request's maximum cost cannot be bounded (unpriced model, unbounded input). */
  unboundedReserveUsd: number
  /** Whether an unbounded request counts as `would_deny` (`max_cost_unbounded`). */
  denyUnbounded: boolean
  /** A reservation not settled within this many minutes is expired (charged its estimate). */
  reservationTtlMinutes: number
}

export type BudgetPolicy = BudgetLimits & { version: string; agencyOverrides: Record<string, Partial<BudgetLimits>> }
export type BudgetPolicyInput = Partial<BudgetLimits> & {
  version?: string
  agencyOverrides?: Record<string, Partial<BudgetLimits>>
}

/** Local/test default: observe only. No production thresholds are invented here. */
export const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  version: 'local-default-v1',
  perRequestMaxUsd: null,
  perRunUsd: null,
  conversationDailyUsd: null,
  contactWindowUsd: null,
  contactWindowHours: 24,
  agencyHourlyUsd: null,
  agencyDailyUsd: null,
  agencyPeriodUsd: null,
  globalDailyUsd: null,
  warnAtFraction: 0.8,
  unboundedReserveUsd: 0.1,
  denyUnbounded: true,
  reservationTtlMinutes: 15,
  agencyOverrides: {},
}

export function isAiBudgetShadowEnabled(): boolean {
  return process.env.AI_BUDGET_SHADOW === '1'
}

const LIMIT_KEYS = Object.keys(DEFAULT_BUDGET_POLICY).filter(
  (k) => k !== 'version' && k !== 'agencyOverrides',
) as (keyof BudgetLimits)[]

function clean(input: Partial<BudgetLimits>): Partial<BudgetLimits> {
  const out: Partial<BudgetLimits> = {}
  for (const k of LIMIT_KEYS) {
    if (!(k in input)) continue
    const v = (input as Record<string, unknown>)[k]
    if (k === 'denyUnbounded') {
      if (typeof v === 'boolean') out.denyUnbounded = v
    } else if (
      v === null &&
      k !== 'contactWindowHours' &&
      k !== 'warnAtFraction' &&
      k !== 'unboundedReserveUsd' &&
      k !== 'reservationTtlMinutes'
    ) {
      ;(out as Record<string, unknown>)[k] = null
    } else if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      ;(out as Record<string, unknown>)[k] = v
    }
  }
  return out
}

/** The policy for one agency, read per call. Never throws. */
export function budgetPolicyFor(agencyId: number | null | undefined): BudgetPolicy {
  let base = DEFAULT_BUDGET_POLICY
  const raw = process.env.AI_BUDGET_POLICY
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as BudgetPolicyInput
      base = {
        ...DEFAULT_BUDGET_POLICY,
        ...clean(parsed),
        version: typeof parsed.version === 'string' && parsed.version ? parsed.version.slice(0, 64) : 'env-unversioned',
        agencyOverrides: parsed.agencyOverrides && typeof parsed.agencyOverrides === 'object' ? parsed.agencyOverrides : {},
      }
    } catch {
      console.error('[ai-budget] AI_BUDGET_POLICY is not valid JSON; using the local default')
    }
  }
  const override = agencyId != null ? base.agencyOverrides[String(agencyId)] : undefined
  return override ? { ...base, ...clean(override), version: `${base.version}+agency${agencyId}` } : base
}
