import { db } from '@/config/db'
import { saleStats } from '@/db/helpers/sum_helpers'
import { getDateRange, type Period } from '@/lib/dates'
import { isAdmin, Roles } from '@/types/roles'
import type { SessionlessScope } from '@/db/briefing'

/**
 * Revenue for the Agent — the Performance screen's own numbers, with no session.
 *
 * THE DEFINITIONS ARE PERFORMANCE'S, NOT NEW ONES. /sum_sales computes its boxes
 * as `getSaleStats(formatSqlFilter(...))` (components/sumSales/AllNumbox.tsx).
 * This reader runs the same `saleStats` SQL over the same `_flat_sales` view with
 * the same default filter:
 *
 *   rows      `_flat_sales` — one row per rep share of a deal (sales ⋈ sale_users),
 *             `amount` = the share's amount
 *   agency    = the scope's agency
 *   reps      admin (ADMIN, GM): every rep in the agency; AGNT, MNGR, OFFICE:
 *             `userId IN gotPermIds` (getPerms — self, direct grants, a manager's
 *             teams; `[0]` = none)
 *   action    = 'מכירה'
 *   status    not 'בוטל' / 'נגנז'
 *   period    `offrDt` (the deal's offer date, "תאריך פנייה") BETWEEN the bounds
 *             `getDateRange` gives Performance, or the two dates of a custom range
 *
 *   paidRevenue    SUM(amount) WHERE status = 'שולם'         ("סך הכנסות (שולם)")
 *   paidDeals      COUNT(*)    WHERE status = 'שולם'         ("עסקאות שנסגרו")
 *   pipelineValue  SUM(amount) WHERE status IN ('חדש','בהצעה','במו"מ','ממתין לתשלום')
 *                  — open deals, NOT revenue and NOT a forecast ("פייפליין")
 *
 * Importing `saleStats` and `getDateRange` rather than restating them is what
 * keeps the two from drifting; __tests__/db/agentRevenue.db.test.ts pins the
 * WHERE clauses against Performance's own reader on the same data.
 *
 * WHY IT DOES NOT CALL formatSqlFilter. For an admin (`gotPermIds = []`) it falls
 * through to `getPerms(user)` -> `getUsersAndTeams()` -> `getAgencyId()`, which
 * reads the web session: on the WhatsApp worker and the autonomous path there is
 * none, and it throws. Its admin branch then ignores the result anyway.
 *
 * Read-only.
 */

export type RevenuePeriod = 'this_month' | 'last_month' | 'this_year' | 'last_year' | 'custom'

const PERFORMANCE_PERIOD: Record<Exclude<RevenuePeriod, 'custom'>, Period> = {
  this_month: 'החודש הנוכחי',
  last_month: 'החודש הקודם',
  this_year: 'השנה הנוכחית',
  last_year: 'השנה הקודמת',
}

/** Roles Performance filters by `gotPermIds`. Any other non-admin role has no Performance view to match. */
const PERMISSION_SCOPED = new Set<string>([Roles.AGNT, Roles.MNGR, Roles.OFFICE])

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export type RevenueWindow = { start: Date | string; end: Date | string }

export type RevenueTotals = {
  paidRevenue: number
  paidDeals: number
  pipelineValue: number
  /** Non-cancelled deal shares in the period — 0 means nothing was recorded, not "zero revenue earned". */
  dealsInPeriod: number
  /** Non-cancelled deal shares in scope at any date — 0 means this account records no deals at all. */
  dealsEver: number
}

/** A valid calendar day, `YYYY-MM-DD`. */
export function isIsoDay(s: string): boolean {
  if (!ISO_DAY.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/**
 * The window Performance would apply. A named period: `getDateRange` at `now`.
 * Custom: the two day strings exactly as the Performance date inputs send them.
 */
export function revenueWindow(
  period: RevenuePeriod,
  now: Date,
  range?: { from?: string | null; to?: string | null },
): RevenueWindow | null {
  if (period === 'custom') {
    const from = range?.from ?? ''
    const to = range?.to ?? ''
    if (!isIsoDay(from) || !isIsoDay(to) || from > to) return null
    return { start: from, end: to }
  }
  const w = getDateRange(PERFORMANCE_PERIOD[period], now)
  return w ? { start: w.start, end: w.end } : null
}

/** Whether this role has a Performance view the reader can reproduce. */
export function canReadRevenue(role: string): boolean {
  return isAdmin(role as Roles) || PERMISSION_SCOPED.has(role)
}

function inScope(s: SessionlessScope) {
  const q = db('_flat_sales').where('agencyId', s.agencyId).where('action', 'מכירה').whereNotIn('status', ['נגנז', 'בוטל'])
  if (!isAdmin(s.user.role)) q.whereIn('userId', s.gotPermIds)
  return q
}

export async function getRevenueTotals(s: SessionlessScope, w: RevenueWindow): Promise<RevenueTotals> {
  // Fail closed: a role Performance has no view for gets no numbers, not unfiltered ones.
  if (!canReadRevenue(s.user.role)) throw new Error('revenue: role has no Performance view')
  const [row, ever] = await Promise.all([
    inScope(s).whereBetween('offrDt', [w.start, w.end]).select(db.raw(saleStats)).first(),
    inScope(s).count<{ count: string }>('* as count').first(),
  ])
  const r = (row ?? {}) as Record<string, unknown>
  return {
    paidRevenue: Number(r.totalRevenue ?? 0),
    paidDeals: Number(r.hofakCount ?? 0),
    pipelineValue: Number(r.pipelineValue ?? 0),
    dealsInPeriod: Number(r.prdctsCount ?? 0),
    dealsEver: Number(ever?.count ?? 0),
  }
}
