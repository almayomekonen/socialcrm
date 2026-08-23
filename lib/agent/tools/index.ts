import 'server-only'
import { makeGetTodayState } from './getTodayState'
import { makeGetLead } from './getLead'
import { makeGetConversation } from './getConversation'
import type { AgentScope } from '../types'
import type { Budget } from '../budget'
import type { EvidenceCollector } from '../evidence'

/**
 * The ENTIRE Agent tool surface.
 *
 * Three read-only business capabilities, each built per investigation and each
 * closing over the server-resolved scope. Adding a capability means adding an
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
    get_lead: makeGetLead(deps),
    get_conversation: makeGetConversation(deps),
  }
}
