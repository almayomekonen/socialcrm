import 'server-only'
import {
  isWaAssistantMeetingsAgency,
  isWaAssistantNotesAgency,
  isWaAssistantQuotesAgency,
  isWaAssistantRemindersAgency,
  isWaAssistantStatusAgency,
  isWaAssistantTasksAgency,
} from '@/lib/flags/waAssistantFlags'
import type { runAgentInvestigation } from '@/lib/agent/run'
import type { AgentScope } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { proposeMeeting, type ProposeDeps } from './meetings/propose'
import { proposeTaskOrFollowUp, type TaskProposeDeps } from './tasks/propose'
import { proposeLeadUpdate, type LeadUpdateProposeDeps } from './leadUpdates/propose'
import { proposeQuote, type QuoteProposeDeps } from './quotes/propose'
import { isRequestConversation } from './request'
import { isClarifyingAnswer } from './tasks/draft'
import type { MeetingReply } from './meetings/types'

/**
 * Which writes this agency's assistant may PROPOSE, and the one place a
 * proposal is routed to its capability (./meetings, ./tasks, ./leadUpdates,
 * ./quotes). Extracted from worker.ts (architecture-rules §1: the owed
 * extraction), which keeps the job lifecycle: window, identity, limits, the
 * Agent run and the one reply.
 *
 * Each capability is its own per-agency switch (lib/flags/waAssistantFlags.ts),
 * read per job, never cached. A proposal whose switch is off, or that came as a
 * batch, is not routed: the worker answers it with NO_ACTIONS_NOTE, as before.
 */

export type AssistantCapabilities = {
  meetingsOn: boolean
  tasksOn: boolean
  statusOn: boolean
  notesOn: boolean
  remindersOn: boolean
  quotesOn: boolean
  /** Any write at all: decides whether a tap or a bare "כן" means anything here. */
  writesOn: boolean
}

export function assistantCapabilities(agencyId: number): AssistantCapabilities {
  const caps = {
    meetingsOn: isWaAssistantMeetingsAgency(agencyId),
    tasksOn: isWaAssistantTasksAgency(agencyId),
    statusOn: isWaAssistantStatusAgency(agencyId),
    notesOn: isWaAssistantNotesAgency(agencyId),
    remindersOn: isWaAssistantRemindersAgency(agencyId),
    quotesOn: isWaAssistantQuotesAgency(agencyId),
  }
  return { ...caps, writesOn: Object.values(caps).some(Boolean) }
}

export type ProposalRouteDeps = {
  meetings?: ProposeDeps
  tasks?: TaskProposeDeps
  leadUpdates?: LeadUpdateProposeDeps
  quotes?: QuoteProposeDeps
}

type AgentSuccess = Extract<Awaited<ReturnType<typeof runAgentInvestigation>>, { ok: true }>

/** The proposal's card (or its one question), or null when no switched-on capability takes it. */
export async function routeProposal(input: {
  job: WaAssistantJob
  scope: AgentScope
  result: AgentSuccess
  caps: AssistantCapabilities
  nowMs: number
  deps?: ProposalRouteDeps
}): Promise<MeetingReply | null> {
  const { job, scope, result, caps, nowMs, deps } = input
  const proposed = result.answer.proposedAction
  if (!proposed || result.answer.proposedBatch) return null
  const common = { job, scope, evidence: result.evidence, agentRunId: result.investigationId, question: job.question?.trim() ?? '', nowMs }

  if (caps.meetingsOn && proposed.actionType === 'create_meeting') return proposeMeeting({ ...common, proposal: proposed, deps: deps?.meetings })
  if (caps.tasksOn && (proposed.actionType === 'create_task' || proposed.actionType === 'create_follow_up'))
    return proposeTaskOrFollowUp({ ...common, proposal: proposed, deps: deps?.tasks })
  if ((caps.statusOn && proposed.actionType === 'update_lead_status') || (caps.notesOn && proposed.actionType === 'add_lead_note'))
    return proposeLeadUpdate({ ...common, proposal: proposed as Parameters<typeof proposeLeadUpdate>[0]['proposal'], deps: deps?.leadUpdates })
  if (caps.quotesOn && proposed.actionType === 'create_quote') return proposeQuote({ ...common, proposal: proposed, deps: deps?.quotes })
  return null
}

/**
 * The Agent's own question inside an open request ("לאיזה ליד?") keeps that
 * request open for the next message. Returns the stop reason that does so, or null.
 */
export async function agentClarifyStopReason(job: WaAssistantJob, result: AgentSuccess, caps: AssistantCapabilities, hasNote: boolean): Promise<string | null> {
  if (hasNote || !isClarifyingAnswer(result.answer)) return null
  // "הצעת מחיר" is specific; checked first so a quote's question never reads as a task's.
  if (caps.quotesOn && (await isRequestConversation('quote', job))) return 'quote_clarify_agent'
  // "תקבע" opens both a meeting and a follow-up: it is a meeting only when the owner says so, or the open request already is one.
  if (caps.tasksOn && !/פגיש/u.test(job.question ?? '') && (await isRequestConversation('task', job))) return 'task_clarify_agent'
  if (caps.meetingsOn && (await isRequestConversation('meeting', job))) return 'meeting_clarify_agent'
  return null
}
