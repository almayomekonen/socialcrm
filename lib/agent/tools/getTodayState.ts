import 'server-only'
import { z } from 'zod'
import { tool } from 'ai'
import { buildTodayBrief } from '@/lib/today/service'
import { readerScope } from './readerScope'
import type { AgentScope } from '../types'
import type { Budget } from '../budget'
import type { EvidenceCollector } from '../evidence'

/**
 * Tool 1 — the deterministic "what needs attention" set.
 *
 * Wraps the existing Today engine unchanged. It takes NO INPUT: the scope comes
 * from the closure and the business day is computed server-side, so there is no
 * argument through which the model could widen what it sees.
 *
 * PROJECTION, not pass-through. Two reasons:
 *   · `BriefItem` carries `conversationId` / `href` / `waitingFor` /
 *     `windowHint` only in the uncommitted waiting-spotlight work. Projecting
 *     just the stable fields keeps this tool from depending on code that is not
 *     in any commit.
 *   · `phone` is PII the Agent does not need — it recommends who to contact,
 *     the rep opens the lead to do it.
 *
 * The item count is deliberately NOT capped: the Today engine is data-driven by
 * design, and truncating it here would make the Agent understate the workload.
 */
/** Metric ids, shared by the evidence ledger and the model-facing payload. */
const METRIC_TOTAL = 'today.total'
const METRIC_REMAINING = 'today.remaining'

/** The ids this tool guarantees to both record and expose. */
export const TODAY_METRIC_IDS = [METRIC_TOTAL, METRIC_REMAINING] as const

export function makeGetTodayState(deps: { scope: AgentScope; evidence: EvidenceCollector; budget: Budget; nowMs: number }) {
  return tool({
    description:
      'The rep\'s current work queue: every lead that needs action today, already prioritised and deduplicated by the CRM, plus the totals and today\'s meetings. Call this first for any "what needs attention / what should I do / what is waiting" question. Takes no arguments.',
    inputSchema: z.object({}),
    execute: async () => {
      const verdict = deps.budget.canStep('get_today_state', '')
      if (verdict.allowed === false) return { refused: true as const, reason: verdict.reason }

      const brief = await buildTodayBrief(
        {
          scope: readerScope(deps.scope),
          agencyId: deps.scope.agencyId,
          userId: deps.scope.userId,
          firstName: deps.scope.firstName,
        },
        deps.nowMs,
      )

      const asOf = new Date(deps.nowMs).toISOString()
      const window = { from: asOf, to: asOf }
      // ONE source for each metric id: the same constant is recorded as evidence
      // and returned to the model, so the two cannot drift apart again.
      const metrics: Record<string, number> = {
        [METRIC_TOTAL]: brief.total,
        [METRIC_REMAINING]: brief.remaining,
      }
      for (const [metric, n] of Object.entries(metrics)) deps.evidence.add({ kind: 'metric', metric, window, n })
      for (const item of brief.items) deps.evidence.add({ kind: 'lead', refId: String(item.id) })

      const payload = {
        items: brief.items.map((i) => ({
          leadId: i.id,
          name: i.name,
          state: i.state,
          reason: i.reason,
          targetSurface: i.targetSurface,
        })),
        // The metric IDENTIFIERS, not just their values. A claim may only cite a
        // name the collector holds, so a payload that showed `total: 19` and hid
        // `today.total` asked the model to cite something it had never seen —
        // and every count-shaped answer lost all its evidence (inv_mt7795vh_ptvevm).
        metrics,
        total: brief.total,
        remaining: brief.remaining,
        handledToday: brief.handledToday,
        volumeState: brief.volumeState,
        statusVerdict: brief.statusVerdict,
        meetings: brief.meetings.map((m) => ({ title: m.title, at: new Date(m.at).toISOString() })),
      }

      deps.budget.noteResult(JSON.stringify(payload))
      return payload
    },
  })
}
