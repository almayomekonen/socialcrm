import 'server-only'
import { makeGetTodayState } from './getTodayState'
import { makeFindLead } from './findLead'
export { TODAY_METRIC_IDS } from './getTodayState'
import { makeGetLead } from './getLead'
import { makeGetConversation } from './getConversation'
import { makeGetLeadSegment } from './getLeadSegment'
import { makeGetBusinessSummary } from './getBusinessSummary'
export { LEAD_SEGMENT_IDS, SEGMENT_METRIC_IDS } from './getLeadSegment'
export { BUSINESS_SUMMARY_METRIC_IDS } from './getBusinessSummary'
import type { AgentScope } from '../types'
import type { Budget } from '../budget'
import type { EvidenceCollector } from '../evidence'

/**
 * The ENTIRE Agent tool surface.
 *
 * Six read-only business capabilities, each built per investigation and each
 * closing over the server-resolved scope.
 *
 * THEY DIVIDE BY QUESTION SHAPE, not by table:
 *   get_today_state       what should I do now        (prioritised queue)
 *   get_business_summary   what is going on            (counts, no names)
 *   get_lead_segment       who is in this category     (one named segment)
 *   find_lead              who is this person          (name → leadId)
 *   get_lead               everything about one lead
 *   get_conversation       what was actually said
 *
 * Still read-only. Nothing here writes, sends, or schedules; an action surface
 * would need its own confirmation boundary and does not exist yet. Adding a capability means adding an
 * entry here — there is no dynamic registration, no database handle, and no
 * tool that accepts a filter it does not control.
 *
 * The invariant every tool upholds:
 *
 *   AGENT → TOOL → SOCIALCRM BUSINESS READER → SCOPED DATA → EVIDENCE → AGENT
 *
 * The model supplies only business identifiers it received from an earlier
 * tool result. It never supplies agencyId, userId, role, plan or permissions —
 * those live in the closure, which is what makes tenant isolation structural
 * rather than a prompt instruction.
 */
export type ToolDeps = {
  scope: AgentScope
  evidence: EvidenceCollector
  budget: Budget
  /** Injected clock, so the business day and evidence stamps are deterministic. */
  nowMs: number
}

export function buildAgentTools(deps: ToolDeps) {
  return {
    get_today_state: makeGetTodayState(deps),
    find_lead: makeFindLead(deps),
    get_lead: makeGetLead(deps),
    get_conversation: makeGetConversation(deps),
    get_lead_segment: makeGetLeadSegment(deps),
    get_business_summary: makeGetBusinessSummary(deps),
  }
}
