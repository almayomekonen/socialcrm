import 'server-only'
import { z } from 'zod'
import { tool } from 'ai'
import { buildTodayBrief } from '@/lib/today/service'
import { readerScope } from './readerScope'
import type { AgentScope } from '../types'
import type { Budget } from '../budget'
import { entityRef } from '../evidence'
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
 *
 * SCOPE OF THE DESCRIPTION, and why it is worded so defensively. It previously
 * read "call this first for any what-needs-attention / what-should-I-do
 * question" — which is the phrasing of a broad business-judgement question, so
 * the model called this and stopped. Evaluation caught it: asked "מה הבעיה הכי
 * גדולה שלי?" on a tenant with 8 queue items, 11 leads with no next step and 11
 * gone cold, the answer came from the queue alone and never saw either
 * structural problem. Today is a DAILY view; a stale lead can be absent from it
 * entirely, so a non-empty queue is not evidence that these are the biggest
 * problems in the business. The description now says so and names the tool to
 * pair with.
 */
/** Metric ids, shared by the evidence ledger and the model-facing payload. */
const METRIC_TOTAL = 'today.total'
const METRIC_REMAINING = 'today.remaining'

/** The ids this tool guarantees to both record and expose. */
export const TODAY_METRIC_IDS = [METRIC_TOTAL, METRIC_REMAINING] as const

export function makeGetTodayState(deps: { scope: AgentScope; evidence: EvidenceCollector; budget: Budget; nowMs: number }) {
  return tool({
    description:
      'TODAY\'S WORK QUEUE ONLY: the leads needing action today, already prioritised and deduplicated by the CRM, plus today\'s totals and meetings. Use it for "what do I have today", "what is waiting right now", "what is on my plate". It is a DAILY view, NOT a measure of business health — a lead that is stale, has no next step, or has gone cold may be absent from it entirely. So a non-empty queue does NOT mean these are the business\'s biggest problems. For any broad judgement question — the biggest problem, what to focus on, what is being missed, where the business is leaking — pair this with get_lead_health, because answering from this queue alone will miss every structural issue. Takes no arguments.',
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
          /** Cite THIS string. See `entityRef` — the format is given, not inferred. */
          evidenceRef: entityRef('lead', i.id),
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
