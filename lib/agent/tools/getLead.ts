import 'server-only'
import { z } from 'zod'
import { tool } from 'ai'
import { getNamedLeadById } from '@/db/briefing'
import { getLeadIntelligenceInputs } from '@/db/aiSummaries'
import { outcomeLabel } from '@/lib/leads/outcomeRules'
import type { AgentScope } from '../types'
import type { Budget } from '../budget'
import type { EvidenceCollector } from '../evidence'

const MAX_RECENT_TASKS = 5

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
export function makeGetLead(deps: { scope: AgentScope; evidence: EvidenceCollector; budget: Budget }) {
  return tool({
    description:
      'Everything operational about one lead: status, source, owner, days since last contact, days in the current stage, overdue tasks, task completion, next follow-up, the last call outcome and the rep\'s notes. Use it when a question is about a specific lead, or to understand why a lead appeared in the work queue. The leadId must come from an earlier tool result.',
    inputSchema: z.object({
      leadId: z.number().int().positive().describe('The lead id, taken from an earlier tool result. Never invented.'),
    }),
    execute: async ({ leadId }) => {
      const verdict = deps.budget.canStep('get_lead', String(leadId))
      if (verdict.allowed === false) return { refused: true as const, reason: verdict.reason }

      // ── Gate. A lead outside the agency, outside gotPermIds, over quota on a
      //    free plan, or no longer flagged as a lead is simply not found.
      const named = await getNamedLeadById(
        { user: { role: deps.scope.role }, gotPermIds: deps.scope.gotPermIds },
        leadId,
      )
      if (!named) {
        deps.budget.noteResult(`not_found:${leadId}`)
        return { found: false as const, leadId }
      }

      // ── Enrich only after the gate has passed.
      const snap = await getLeadIntelligenceInputs(leadId).catch(() => null)
      const i = snap?.inputs

      deps.evidence.add({ kind: 'lead', refId: String(leadId) })

      const payload = {
        found: true as const,
        leadId,
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
