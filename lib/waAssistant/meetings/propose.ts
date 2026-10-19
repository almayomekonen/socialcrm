import 'server-only'
import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import { submitProposedAction } from '@/lib/agent/actions/bridge'
import { businessInstantMs } from '@/lib/today/time'
import { createWaApproval } from '@/db/waAssistantApprovals'
import { getCalendarConnectionByUserId } from '@/db/googleCalendarConnections'
import { CALENDAR_EVENTS_SCOPE } from '@/lib/integrations/google/calendarTokens'
import type { AgentScope, ProposedAction } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { findMeetingConflicts, suggestFreeSlots } from './conflicts'
import { MEETING_COPY, confirmationCard, conflictReply, decisionButtons } from './copy'
import { resolveWhen } from './when'
import type { MeetingReply } from './types'

/**
 * "תקבע לי עם Itamar Am מחר ב-10:00" → a confirmation card, or a question.
 *
 * NOTHING IS CREATED HERE. In order:
 *   1. the date and time are read deterministically from the owner's words and
 *      must equal the Agent's arguments; otherwise we ask (never guess);
 *   2. the lead must be readable by THIS user (agency + rep visibility), the same
 *      bound the create_meeting executor enforces;
 *   3. the slot must be free among the organizer's SocialCRM meetings;
 *   4. the existing Action Runtime records the action as AWAITING_APPROVAL —
 *      submitted WITHOUT the user's words, so intent is AGENT_PROPOSAL and the
 *      runtime itself requires an approval, whatever the phrasing;
 *   5. a single-use token binds the card's buttons to that action + argsHash.
 */

const CLARIFY_WINDOW_MS = 15 * 60 * 1000

type MeetingProposal = Extract<ProposedAction, { actionType: 'create_meeting' }>

export type ProposeDeps = { submit?: typeof submitProposedAction }

const MEETING_WORDS = /פגיש|תקבע|לקבוע|קבע/u

/**
 * The owner's previous message, if this one completes the same meeting request:
 * within 15 minutes, and either our own clarification question answered it or it
 * was itself about a meeting. Never general history ("סכם לי את היום").
 */
async function clarifiedQuestion(job: WaAssistantJob, nowMs: number): Promise<string[]> {
  const prev = (await db('wa_assistant_jobs')
    .where({ recipientId: job.recipientId, kind: 'text' })
    .where('id', '<', job.id)
    .orderBy('id', 'desc')
    .first('question', 'stopReason', 'createdAt')) as { question: string | null; stopReason: string | null; createdAt: Date } | undefined
  if (!prev?.question || nowMs - new Date(prev.createdAt).getTime() > CLARIFY_WINDOW_MS) return []
  return prev.stopReason?.startsWith('meeting_clarify') || MEETING_WORDS.test(prev.question) ? [prev.question] : []
}

const clarify = (text: string, why: string): MeetingReply => ({ status: 'answered', stopReason: `meeting_clarify_${why}`, text, headline: text })

export async function googleCalendarConnected(userId: number): Promise<boolean> {
  const conn = await getCalendarConnectionByUserId(userId)
  return !!conn && conn.sync_status === 'active' && !!conn.scope?.includes(CALENDAR_EVENTS_SCOPE)
}

export async function proposeMeeting(input: {
  job: WaAssistantJob
  scope: AgentScope
  proposal: MeetingProposal
  agentRunId: string
  question: string
  nowMs: number
  deps?: ProposeDeps
}): Promise<MeetingReply> {
  const { job, scope, proposal, nowMs } = input
  const args = proposal.args

  const when = resolveWhen(input.question, await clarifiedQuestion(job, nowMs), nowMs)
  if (when.problem === 'ambiguous_time') return clarify(MEETING_COPY.ambiguousTime, 'time')
  if (when.problem === 'ambiguous_date') return clarify(MEETING_COPY.ambiguousDate, 'date')
  if (when.problem === 'past_date') return clarify(MEETING_COPY.pastDate, 'past')
  if (!when.date) return clarify(MEETING_COPY.askDate, 'date')
  if (!when.time) return clarify(MEETING_COPY.askTime, 'time')
  if (when.date !== args.date || when.time !== args.startTime) return clarify(MEETING_COPY.mismatch, 'mismatch')

  const startMs = businessInstantMs(args.date, args.startTime)
  if (!Number.isFinite(startMs) || startMs <= nowMs) return clarify(MEETING_COPY.pastDate, 'past')
  const start = new Date(startMs)
  const end = new Date(startMs + args.durationMinutes * 60_000)

  const leadQuery = db('clients').where({ id: args.clientId, agencyId: scope.agencyId })
  if (!isAdmin(scope.role)) leadQuery.whereIn('userId', scope.gotPermIds ?? [])
  const lead = (await leadQuery.first('firstName', 'lastName')) as { firstName: string | null; lastName: string | null } | undefined
  if (!lead) return { status: 'refused', stopReason: 'meeting_lead_not_allowed', text: MEETING_COPY.leadNotAllowed, headline: null }
  const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ')

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
