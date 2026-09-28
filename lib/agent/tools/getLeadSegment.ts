import 'server-only'
import { z } from 'zod'
import { tool } from 'ai'
import {
  getFollowUpsDueToday,
  getLeadsNotContactedRecently,
  getNewLeadsThisWeek,
  getOverdueTaskSummary,
  getPromisedButWaiting,
  type BriefingLeadList,
} from '@/db/briefing'
import { readerScope } from './readerScope'
import type { AgentScope } from '../types'
import type { Budget } from '../budget'
import { entityRef } from '../evidence'
import type { EvidenceCollector } from '../evidence'

/**
 * Tool 5 — the named lead segments the CRM already computes.
 *
 * ONE TOOL, FIVE SEGMENTS, and the shape is the reason. Five separate tools
 * would each consume a name in the model's tool list and, worse, a step from a
 * budget whose ceiling is SIX (`DEFAULT_MAX_STEPS`) — a question needing three
 * segments plus a lead lookup would exhaust the investigation on plumbing. An
 * enum lets the model ask for exactly the slice it needs and leaves room to
 * follow up on what it finds.
 *
 * EVERY SEGMENT IS AN EXISTING READER, unchanged. These are the same queries the
 * Today briefing and General Mode already run, so the Agent and the rest of the
 * product cannot disagree about who is overdue — there is no second definition
 * of "stale" or "waiting" here. Thresholds live in
 * `lib/copilot/general/constants` (STALE_DAYS, WEEK_START_SQL) and reach the
 * Agent only as results, never as prompt text.
 *
 * AUTHORIZATION IS INHERITED. Each reader builds on `scopedLeads`, which applies
 * the agency, `gotPermIds` for non-admins, the free-plan `overQuota` filter and
 * `lead = true`. The agency comes from `readerScope(deps.scope)` — the
 * server-resolved closure — and the enum is the ONLY thing the model controls.
 * There is no filter, no limit and no id it can supply.
 *
 * TOTAL AND SAMPLE ARE DIFFERENT FACTS. The readers return `total` (a window
 * count over the whole matching set) alongside a capped `sample`. Both are
 * surfaced, and the metric records the total rather than the sample length, so
 * the Agent can say "11 leads are waiting" while naming only the handful it can
 * actually cite.
 */

type SegmentScope = ReturnType<typeof readerScope>
type SegmentDef = { read: (s: SegmentScope) => Promise<BriefingLeadList>; metric: string; label: string }

/**
 * Segment id → the reader that defines it. Adding a segment is one line here.
 *
 * `read` WRAPS each reader in an arrow rather than referencing it directly, and
 * that is not a style choice. A bare `read: getFollowUpsDueToday` dereferences
 * the import when this module initialises, which throws under the existing agent
 * suites: they `vi.mock('@/db/briefing')` with only the handful of exports the
 * older tools needed, and vitest's mock throws on access to anything absent. The
 * arrow defers the lookup to the moment a segment is actually requested, so a
 * test that never asks for a segment never touches the export — and one that
 * does gets a clear failure naming the reader it forgot to mock.
 */
const SEGMENTS: Record<string, SegmentDef> = {
  followups_due_today: {
    read: (s) => getFollowUpsDueToday(s),
    metric: 'segment.followups_due_today',
    label: 'leads with a follow-up scheduled for today',
  },
  not_contacted_recently: {
    read: (s) => getLeadsNotContactedRecently(s),
    metric: 'segment.not_contacted_recently',
    label: 'open leads with no contact for a long time (the CRM defines the window)',
  },
  new_this_week: {
    read: (s) => getNewLeadsThisWeek(s),
    metric: 'segment.new_this_week',
    label: 'leads created since the start of this week',
  },
  overdue_tasks: {
    read: (s) => getOverdueTaskSummary(s),
    metric: 'segment.overdue_tasks',
    label: 'leads carrying a task that is past due',
  },
  waiting_for_reply: {
    read: (s) => getPromisedButWaiting(s),
    metric: 'segment.waiting_for_reply',
    label: 'leads where the customer spoke last and is still waiting on the business',
  },
}

export type LeadSegmentId = string

export const LEAD_SEGMENT_IDS = Object.keys(SEGMENTS) as [string, ...string[]]

/** Metric ids this tool can record. Exported so tests assert against one source. */
export const SEGMENT_METRIC_IDS = Object.values(SEGMENTS).map((s) => s.metric)

export function makeGetLeadSegment(deps: {
  scope: AgentScope
  evidence: EvidenceCollector
  budget: Budget
  nowMs: number
}) {
  return tool({
    description:
      'Fetch one named segment of leads that the CRM already computes. Use it when the question is about a CATEGORY of leads rather than the prioritised queue or one person: who is waiting for a reply, who has gone cold, what came in this week, what follow-ups are due, which tasks are overdue. Returns the true total plus a sample of leads you may cite by leadId. Prefer get_today_state when the rep asks the open-ended "what should I do now".',
    inputSchema: z.object({
      segment: z
        .enum(LEAD_SEGMENT_IDS)
        .describe(
          Object.entries(SEGMENTS)
            .map(([id, s]) => `${id}: ${s.label}`)
            .join(' | '),
        ),
    }),
    execute: async ({ segment }) => {
      const verdict = deps.budget.canStep('get_lead_segment', segment)
      if (verdict.allowed === false) return { refused: true as const, reason: verdict.reason }

      const def = SEGMENTS[segment]
      if (!def) return { refused: true as const, reason: 'error' as const }
      const list = await def.read(readerScope(deps.scope))

      const asOf = new Date(deps.nowMs).toISOString()
      // The metric carries the TRUE total, not the sample length — an OBSERVATION
      // citing it would otherwise understate the workload by exactly the cap.
      deps.evidence.add({ kind: 'metric', metric: def.metric, window: { from: asOf, to: asOf }, n: list.total })
      for (const row of list.sample) deps.evidence.add({ kind: 'lead', refId: String(row.id) })

      const payload = {
        segment,
        // The metric IDENTIFIER as well as its value: a claim may only cite a name
        // the collector holds, so hiding it would make every count-shaped answer
        // uncitable. Same lesson as `get_today_state`.
        metrics: { [def.metric]: list.total },
        total: list.total,
        sample: list.sample.map((r) => ({
          leadId: r.id,
          /** Cite THIS string. See `entityRef` — the format is given, not inferred. */
          evidenceRef: entityRef('lead', r.id),
          name: r.name,
          status: r.status,
          ageDays: r.ageDays ?? null,
          waitingDays: r.waitingDays ?? null,
          freshnessDays: r.freshnessDays ?? null,
        })),
        /** True when `total` exceeds what is listed, so the model never implies the sample is everything. */
        truncated: list.total > list.sample.length,
      }

      deps.budget.noteResult(JSON.stringify(payload))
      return payload
    },
  })
}
