import 'server-only'
import { z } from 'zod'
import { tool } from 'ai'
import { canReadRevenue, getRevenueTotals, revenueWindow, type RevenuePeriod } from '@/db/agentRevenue'
import { isAdmin } from '@/types/roles'
import { readerScope } from './readerScope'
import type { AgentScope } from '../types'
import type { Budget } from '../budget'
import type { EvidenceCollector } from '../evidence'

/**
 * Tool 10 — what the business earned, as the Performance screen counts it.
 *
 * WHAT IT IS FOR. "כמה העסק עשה השנה", "כמה כסף נכנס החודש", "כמה יש לי
 * בפייפליין". Before this the agent could only point at «ביצועים»; now it reads
 * the same numbers that screen shows (db/agentRevenue.ts holds the definitions).
 *
 * THREE NUMBERS THAT MUST NEVER BE CONFLATED, and are emitted as separate metrics
 * so a claim has to cite the one it states:
 *   revenue.paid        money from deals marked שולם — the only "revenue"
 *   revenue.paid_deals  how many such deals
 *   revenue.pipeline    open deals' value (חדש/בהצעה/במו"מ/ממתין לתשלום) — not
 *                       revenue, and not a forecast of it
 *
 * THE PERIOD IS BY OFFER DATE (`offrDt`), as on Performance: a deal offered in
 * December and paid in January counts in December. The payload says so, so the
 * answer can.
 *
 * Scope from `readerScope(deps.scope)`; the model supplies only the period. A role
 * Performance has no view for gets an explicit refusal and no evidence, and an
 * account that has never recorded a deal is reported as such — not as ₪0 earned.
 */

export const REVENUE_METRIC_IDS = ['revenue.paid', 'revenue.paid_deals', 'revenue.pipeline', 'revenue.deals_in_period'] as const

const PERIOD_LABEL: Record<RevenuePeriod, string> = {
  this_month: 'החודש הנוכחי',
  last_month: 'החודש הקודם',
  this_year: 'השנה הנוכחית',
  last_year: 'השנה הקודמת',
  custom: 'טווח תאריכים',
}

const day = (d: Date | string) =>
  typeof d === 'string'
    ? d
    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function makeGetRevenue(deps: { scope: AgentScope; evidence: EvidenceCollector; budget: Budget; nowMs: number }) {
  return tool({
    description:
      'The business\'s recorded revenue for a period, exactly as the Performance screen («ביצועים») computes it: paid revenue (deals with status שולם), the number of paid deals, and pipeline value (open deals: חדש, בהצעה, במו"מ, ממתין לתשלום) — three separate numbers. Deals are dated by their offer date. Pipeline is NOT revenue and NOT a forecast. Use for questions about income, sales, revenue or money in a period. period: this_month | last_month | this_year | last_year | custom (custom needs from and to as YYYY-MM-DD).',
    inputSchema: z.object({
      period: z.enum(['this_month', 'last_month', 'this_year', 'last_year', 'custom']),
      from: z.string().optional().describe('YYYY-MM-DD, only with period=custom'),
      to: z.string().optional().describe('YYYY-MM-DD, only with period=custom'),
    }),
    execute: async ({ period, from, to }) => {
      const verdict = deps.budget.canStep('get_revenue', `${period}:${from ?? ''}:${to ?? ''}`)
      if (verdict.allowed === false) return { refused: true as const, reason: verdict.reason }

      // A non-admin with no reps in scope (`[]`, or getPerms' `[0]` "nobody"
      // sentinel) would read ₪0 and recordsDeals=false — which the answer would
      // state as "the business records no deals". It is no access, and says so.
      const noReps = !isAdmin(deps.scope.role) && !deps.scope.gotPermIds.some((id) => id > 0)
      if (!canReadRevenue(deps.scope.role) || noReps) {
        const payload = {
          restricted: true as const,
          reason: noReps
            ? "This user may not see any rep's deals."
            : 'This user role has no access to the Performance screen numbers.',
        }
        deps.budget.noteResult(JSON.stringify(payload))
        return payload
      }

      const window = revenueWindow(period, new Date(deps.nowMs), { from, to })
      if (!window) {
        const payload = {
          invalidRange: true as const,
          reason: 'custom needs from and to as real YYYY-MM-DD dates, from not after to.',
        }
        deps.budget.noteResult(JSON.stringify(payload))
        return payload
      }

      const t = await getRevenueTotals(readerScope(deps.scope), window)
      const bounds = { from: day(window.start), to: day(window.end) }
      const metrics = {
        'revenue.paid': t.paidRevenue,
        'revenue.paid_deals': t.paidDeals,
        'revenue.pipeline': t.pipelineValue,
        'revenue.deals_in_period': t.dealsInPeriod,
      }
      const n: Record<string, number> = {
        'revenue.paid': t.paidDeals,
        'revenue.paid_deals': t.paidDeals,
        'revenue.pipeline': t.dealsInPeriod,
        'revenue.deals_in_period': t.dealsInPeriod,
      }
      for (const [metric, value] of Object.entries(metrics))
        deps.evidence.add({ kind: 'metric', metric, window: bounds, n: n[metric] ?? value })

      const payload = {
        period,
        periodLabel: PERIOD_LABEL[period],
        // Only a custom range's dates are the user's own. A named period's bounds
        // are Performance's internal window (e.g. "this month" ends next month),
        // and stated back they would misdescribe the period; they stay on the evidence.
        ...(period === 'custom' ? bounds : {}),
        dateBasis: 'offer date (תאריך פנייה), as on the Performance screen',
        currency: 'ILS',
        metrics,
        recordsDeals: t.dealsEver > 0,
        scope: isAdmin(deps.scope.role) ? 'whole agency' : 'the deals this user may see on Performance',
      }
      deps.budget.noteResult(JSON.stringify(payload))
      return payload
    },
  })
}
