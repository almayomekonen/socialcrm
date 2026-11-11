import 'server-only'
import { submitProposedAction } from '@/lib/agent/actions/bridge'
import { businessInstantMs } from '@/lib/today/time'
import { createWaApproval } from '@/db/waAssistantApprovals'
import { getCalendarConnectionByUserId } from '@/db/googleCalendarConnections'
import { CALENDAR_EVENTS_SCOPE } from '@/lib/integrations/google/calendarTokens'
import type { AgentScope, EvidenceRef, ProposedAction } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { findMeetingConflicts, suggestFreeSlots } from './conflicts'
import { MEETING_COPY, confirmationCard, conflictReply, decisionButtons } from './copy'
import { hebrewDateLabel } from './when'
import type { MeetingReply } from './types'
import { requestMessages } from '../request'
import { chooseLead } from '../leadChoice'
import { whenQuestion } from '../whenCopy'
import { readDraft, settleWhen } from '../tasks/draft'

/**
 * "תקבע לי לשעה 12:00 פגישה עם אבי כהן מחר" → the confirmation card at once
 * whenever the request is complete, otherwise ONE short question about the one
 * detail that is genuinely missing or ambiguous. The request is read across the
 * owner's messages (request.ts), so nothing they said is asked for again.
 *
 * NOTHING IS CREATED HERE. In order:
 *   1. the lead (leadChoice.ts): readable by THIS user (agency + rep
 *      visibility), the same bound the create_meeting executor enforces;
 *      several matching leads → the owner chooses, never us;
 *   2. the day and time come from the owner's own words, never the Agent's
 *      arithmetic; no day named → today (business timezone); a meeting needs a
 *      time, so a missing one is asked; a time today that already passed is
 *      asked about, never moved silently;
 *   3. the slot must be free among the organizer's SocialCRM meetings;
 *   4. the existing Action Runtime records the action as AWAITING_APPROVAL —
 *      submitted WITHOUT the user's words, so intent is AGENT_PROPOSAL and the
 *      runtime itself requires an approval, whatever the phrasing;
 *   5. a single-use token binds the card's buttons to that action + argsHash.
 */

type MeetingProposal = Extract<ProposedAction, { actionType: 'create_meeting' }>

export type ProposeDeps = { submit?: typeof submitProposedAction }

/** `headline` is what the Agent reads back next turn: the question plus what is already settled. */
const clarify = (text: string, why: string, memo: string[] = []): MeetingReply => ({
  status: 'answered',
  stopReason: `meeting_clarify_${why}`,
  text,
  headline: memo.length ? `${text} (${memo.join(' · ')})` : text,
})

export async function googleCalendarConnected(userId: number): Promise<boolean> {
  const conn = await getCalendarConnectionByUserId(userId)
  return !!conn && conn.sync_status === 'active' && !!conn.scope?.includes(CALENDAR_EVENTS_SCOPE)
}

export async function proposeMeeting(input: {
  job: WaAssistantJob
  scope: AgentScope
  proposal: MeetingProposal
  evidence?: readonly EvidenceRef[]
  agentRunId: string
  question: string
  nowMs: number
  deps?: ProposeDeps
}): Promise<MeetingReply> {
  const { job, scope, nowMs } = input
  const said = await requestMessages('meeting', job, input.question)
  const draft = readDraft(said, nowMs)
  const memo = (leadName?: string) =>
    ['פגישה', leadName ? `ליד: ${leadName}` : null, draft.date ? hebrewDateLabel(draft.date) : null, draft.when].filter((x): x is string => !!x)

  // 1. Which lead.
  const choice = await chooseLead({ scope, proposedId: Number(input.proposal.args.clientId), evidence: input.evidence ?? [], said, request: { job, kind: 'meeting' } })
  if ('refused' in choice) return { status: 'refused', stopReason: 'meeting_lead_not_allowed', text: MEETING_COPY.leadNotAllowed, headline: null }
  if ('ask' in choice) return clarify(choice.ask, 'lead', memo())
  const leadName = choice.lead.name

  // 2. When, from the owner's words; no day named → today.
  const when = settleWhen(draft, nowMs, { timeRequired: true })
  if (when.ok === false) return clarify(whenQuestion(when.ask, when), when.ask, memo(leadName))
  const args = { ...input.proposal.args, clientId: choice.lead.id, date: when.date, startTime: when.time! }
  const ref = `lead:${args.clientId}`
  const evidenceRefs = input.proposal.evidenceRefs.includes(ref) ? input.proposal.evidenceRefs : [...input.proposal.evidenceRefs, ref]
  const proposal: MeetingProposal = { ...input.proposal, args, evidenceRefs }

  const startMs = businessInstantMs(args.date, args.startTime)
  if (!Number.isFinite(startMs) || startMs <= nowMs) return clarify(whenQuestion('past_date', { hour: null, time: when.time }), 'past', memo(leadName))
  const start = new Date(startMs)
  const end = new Date(startMs + args.durationMinutes * 60_000)

  const conflicts = await findMeetingConflicts({ agencyId: scope.agencyId, organizerUserId: scope.userId, startAt: start, endAt: end })
  if (conflicts.length) {
    const free = await suggestFreeSlots({ agencyId: scope.agencyId, organizerUserId: scope.userId, date: args.date, afterMs: startMs, durationMinutes: args.durationMinutes, nowMs })
    const text = conflictReply(conflicts[0], free)
    return { status: 'answered', stopReason: 'meeting_clarify_conflict', text, headline: text }
  }

  const outcome = await (input.deps?.submit ?? submitProposedAction)({ proposal, scope, agentRunId: input.agentRunId })
  if (!outcome || outcome.report !== 'AWAITING_APPROVAL') {
    return { status: 'failed', stopReason: `meeting_propose_${outcome?.report ?? 'unparsed'}`, text: MEETING_COPY.notPrepared, headline: null }
  }

  const { token } = await createWaApproval({
    recipientId: job.recipientId,
    agencyId: scope.agencyId,
    userId: scope.userId,
    jobId: job.id,
    actionId: outcome.actionId,
    argsHash: outcome.argsHash,
    now: new Date(nowMs),
  })
  const text = confirmationCard({ lead: leadName, date: args.date, start, end, durationMinutes: args.durationMinutes, googleConnected: await googleCalendarConnected(scope.userId) })
  return { status: 'answered', stopReason: 'meeting_awaiting_approval', text, buttons: decisionButtons(token), headline: 'ממתין לאישור קביעת פגישה' }
}
