import 'server-only'
import { makeGetTodayState } from './getTodayState'
import { makeFindLead } from './findLead'
export { TODAY_METRIC_IDS } from './getTodayState'
import { makeGetLead } from './getLead'
import { makeGetConversation } from './getConversation'
import { makeGetLeadSegment } from './getLeadSegment'
import { makeGetBusinessSummary } from './getBusinessSummary'
import { makeGetLeadHealth } from './getLeadHealth'
import { makeGetFollowUpHealth } from './getFollowUpHealth'
import { makeGetActivityTrends } from './getActivityTrends'
import { makeGetRevenue } from './getRevenue'
import { makeListMeetings } from './listMeetings'
export { LEAD_HEALTH_METRIC_IDS } from './getLeadHealth'
export { FOLLOW_UP_METRIC_IDS } from './getFollowUpHealth'
export { ACTIVITY_METRIC_IDS } from './getActivityTrends'
export { LEAD_SEGMENT_IDS, SEGMENT_METRIC_IDS } from './getLeadSegment'
export { BUSINESS_SUMMARY_METRIC_IDS } from './getBusinessSummary'
export { REVENUE_METRIC_IDS } from './getRevenue'
export { MEETING_METRIC_IDS } from './listMeetings'
import type { AgentScope } from '../types'
import type { Budget } from '../budget'
import type { EvidenceCollector } from '../evidence'

/**
 * The ENTIRE Agent tool surface.
 *
 * Eleven read-only business capabilities, each built per investigation and each
 * closing over the server-resolved scope.
 *
 * THEY DIVIDE BY QUESTION SHAPE, not by table:
 *   get_today_state        what should I do now        (prioritised queue)
 *   get_business_summary   what is going on            (counts, no names)
 *   get_lead_segment       who is in this category     (one named segment)
 *   find_lead              who is this person          (name → leadId)
 *   get_lead               everything about one lead
 *   get_conversation       what was actually said
 *   get_lead_health        the shape of the book       (BI — every category)
 *   get_follow_up_health   who am I failing to chase   (BI — the callback loop)
 *   get_activity_trends    busier or quieter           (BI — two windows)
 *   get_revenue            what did the business earn  (Performance's paid revenue + pipeline)
 *   list_meetings          what is on my calendar      (the user's own meetings, by period)
 *
 * THE THREE BI TOOLS RETURN BUSINESS-SHAPED EVIDENCE, never rows: named states
 * with a stated reason, true totals beside capped samples, and — where the
 * product has no such measure — an explicit refusal to supply one. There is no
 * lead score, so none appears; a tool that invented one would be the most
 * convincing thing the agent could get wrong. Revenue exists only as the
 * Performance screen defines it (get_revenue) — never forecast, never estimated.
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
    get_lead_health: makeGetLeadHealth(deps),
    get_follow_up_health: makeGetFollowUpHealth(deps),
    get_activity_trends: makeGetActivityTrends(deps),
    get_revenue: makeGetRevenue(deps),
    list_meetings: makeListMeetings(deps),
  }
}
