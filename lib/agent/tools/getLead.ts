import 'server-only'
import { z } from 'zod'
import { tool } from 'ai'
import { getNamedLeadById } from '@/db/briefing'
import { readerScope } from './readerScope'
import { getLeadIntelligenceInputs } from '@/db/aiSummaries'
import { outcomeLabel } from '@/lib/leads/outcomeRules'
import type { AgentScope } from '../types'
import type { Budget } from '../budget'
import type { EvidenceCollector } from '../evidence'

const MAX_RECENT_TASKS = 5

/**
 * Metric ids for the measurements this tool returns, shared by the evidence
 * ledger and the model-facing payload.
 *
 * The prompt classifies a measurement as an OBSERVATION, and an OBSERVATION must
 * cite a metric NAME. This tool used to return seven numbers and record no metric
 * evidence at all, so the natural answer to "who is this lead" — "12 days without
 * contact, 2 overdue tasks" — had nothing citable and was refused in full
 * (inv_mt8me5sf_99y5es: Sali found, 3 claims, 3 dropped).
 *
 * `recentTasks[].daysOld` is deliberately absent. A per-task measurement would
 * need a distinct id per task, and the evidence model keys a metric by name plus
 * window — so a shared id would silently collapse several tasks into one. Task
 * ages stay descriptive fields the model may quote as part of a FACT about the
 * lead, not as standalone measurements.
 */
const LEAD_METRIC_IDS = {
  daysSinceLastInteraction: 'lead.daysSinceLastInteraction',
  daysInCurrentStatus: 'lead.daysInCurrentStatus',
  daysSinceLastTask: 'lead.daysSinceLastTask',
  overdueTaskCount: 'lead.overdueTaskCount',
  taskCompletionRate: 'lead.taskCompletionRate',
} as const

/** The ids this tool may record. Only those with a real value are emitted. */
export const LEAD_METRIC_ID_LIST = Object.values(LEAD_METRIC_IDS)

/**
 * Tool 2 — one lead's operational picture.
 *
 * AUTHORIZATION FIRST, ALWAYS. `getNamedLeadById` is the gate, not a
 * convenience: it is the only reader that applies all five layers — agency
 * (session-derived), user (`gotPermIds`), role (`isAdmin`), plan (`overQuota`)
 * and `lead = true`. The enrichment reader beneath it (`getFullLead`, via
 * `getLeadIntelligenceInputs`) is agency-scoped ONLY, so enriching before the
 * gate would let any user in the agency read any lead. The order in `execute`
 * is load-bearing and must never be inverted.
 *
 * WON DEALS ARE NOT FOUND. Close Deal sets `lead = false`, and `scopedLeads`
 * filters `lead = true`, so a won deal resolves to null here. That is the CRM's
 * existing visibility rule; this tool reports it rather than working around it.
 *
 * PII AND DEMOGRAPHICS ARE STRIPPED. The enrichment snapshot carries `phone`,
 * `email`, `gender`, `familyStatus`, `ageYears` and `familyMemberCount`. None
 * reach the model: they are not needed to decide what to do next, and the
 * demographic fields are legacy columns that must not become AI inputs.
 */
export function makeGetLead(deps: { scope: AgentScope; evidence: EvidenceCollector; budget: Budget; nowMs: number }) {
  return tool({
    description:
      "Everything operational about one lead: status, source, owner, days since last contact, days in the current stage, overdue tasks, task completion, next follow-up, the last call outcome and the rep's notes. Use it when a question is about a specific lead, or to understand why a lead appeared in the work queue. The leadId must come from an earlier tool result.",
    inputSchema: z.object({
      leadId: z.number().int().positive().describe('The lead id, taken from an earlier tool result. Never invented.'),
    }),
    execute: async ({ leadId }) => {
      const verdict = deps.budget.canStep('get_lead', String(leadId))
      if (verdict.allowed === false) return { refused: true as const, reason: verdict.reason }

      // ── Gate. A lead outside the agency, outside gotPermIds, over quota on a
      //    free plan, or no longer flagged as a lead is simply not found.
      const named = await getNamedLeadById(readerScope(deps.scope), leadId)
      if (!named) {
        deps.budget.noteResult(`not_found:${leadId}`)
        return { found: false as const, leadId }
      }

      // ── Enrich only after the gate has passed.
      const snap = await getLeadIntelligenceInputs(leadId).catch(() => null)
      const i = snap?.inputs

      deps.evidence.add({ kind: 'lead', refId: String(leadId) })

      // ONE source per metric id: recorded as evidence and returned to the model
      // from the same map, so the two cannot drift apart. A measurement with no
      // value is omitted from BOTH rather than reported as zero — an absent
      // number is not the number zero, and the Agent must not imply otherwise.
      const measured: Record<string, number | null | undefined> = {
        [LEAD_METRIC_IDS.daysSinceLastInteraction]: i?.daysSinceLastInteraction,
        [LEAD_METRIC_IDS.daysInCurrentStatus]: i?.daysInCurrentStatus,
        [LEAD_METRIC_IDS.daysSinceLastTask]: i?.daysSinceLastTask,
        [LEAD_METRIC_IDS.overdueTaskCount]: i?.overdueTaskCount ?? 0,
        [LEAD_METRIC_IDS.taskCompletionRate]: i?.taskCompletionRate,
      }
      const metrics: Record<string, number> = {}
      for (const [metric, value] of Object.entries(measured)) {
        if (typeof value === 'number' && Number.isFinite(value)) metrics[metric] = value
      }
      const asOf = new Date(deps.nowMs).toISOString()
      const window = { from: asOf, to: asOf }
      for (const [metric, n] of Object.entries(metrics)) deps.evidence.add({ kind: 'metric', metric, window, n })

      const payload = {
        found: true as const,
        leadId,
        /** The metric IDENTIFIERS behind the numbers below, so a measurement is citable. */
        metrics,
        name: named.name,
        status: i?.status ?? named.status ?? null,
        leadSource: i?.leadSource ?? null,
        handlerName: i?.handlerName ?? null,
        daysSinceLastInteraction: i?.daysSinceLastInteraction ?? null,
        daysInCurrentStatus: i?.daysInCurrentStatus ?? null,
        daysSinceLastTask: i?.daysSinceLastTask ?? null,
        overdueTaskCount: i?.overdueTaskCount ?? 0,
        taskCompletionRate: i?.taskCompletionRate ?? null,
        nextFollowUpAt: named.nextFollowUpAt,
        // The rep-facing label, never the internal code.
        lastOutcome: outcomeLabel(i?.lastOutcomeType ?? null),
        recentTasks: (i?.recentTasks ?? []).slice(0, MAX_RECENT_TASKS).map((t) => ({
          title: t.title,
          status: t.status,
          daysOld: t.daysOld,
        })),
        // Already truncated upstream (detailsExcerpt, 400 chars).
        notes: i?.detailsExcerpt ?? null,
      }

      deps.budget.noteResult(JSON.stringify(payload))
      return payload
    },
  })
}
