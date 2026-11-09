import 'server-only'
import { db } from '@/config/db'
import { decideOnAction } from '@/lib/agent/actions/bridge'
import type { ActionOutcome } from '@/lib/agent/actions'
import { getMeeting } from '@/db/meetings'
import { decideWaApproval, type WaApproval } from '@/db/waAssistantApprovals'
import { businessInstantMs } from '@/lib/today/time'
import type { AgentScope } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { COPY } from '../render'
import { findMeetingConflicts, suggestFreeSlots } from '../meetings/conflicts'
import { conflictReply } from '../meetings/copy'
import type { MeetingReply } from '../meetings/types'
import { CHANGE_COPY, meetingChangedReply, taskChangedReply, type ChangeType } from './copy'
import { mirrorMeetingChange, type GoogleDeps } from './google'

/**
 * A tap on a change card. The caller matched the token to this recipient and
 * the stored action. Here the token is consumed once, then the decision goes
 * through the existing `decideOnAction`: proposer, argsHash, the runtime's
 * claim, the executor's own tenant check and verification. Nothing here writes
 * a task or a meeting; only a verified change is reported as done.
 */

export type ChangeDecideDeps = { decide?: typeof decideOnAction; google?: GoogleDeps }
type Args = { clientId: number; taskId?: number; meetingId?: number; date?: string; startTime?: string; durationMinutes?: number }

const reply = (status: MeetingReply['status'], stopReason: string, text: string | null): MeetingReply => ({ status, stopReason, text, headline: null })

const fullName = (l: { firstName: string | null; lastName: string | null } | undefined) => [l?.firstName, l?.lastName].filter(Boolean).join(' ')

async function leadName(id: number, agencyId: number): Promise<string> {
  return fullName((await db('clients').where({ id, agencyId }).first('firstName', 'lastName')) as never)
}

async function clashAtApproval(args: Args, scope: AgentScope, nowMs: number): Promise<string | null> {
  const startMs = businessInstantMs(args.date!, args.startTime!)
  const busy = { agencyId: scope.agencyId, organizerUserId: scope.userId, excludeMeetingId: args.meetingId! }
  const conflicts = await findMeetingConflicts({ ...busy, startAt: new Date(startMs), endAt: new Date(startMs + args.durationMinutes! * 60_000) })
  if (!conflicts.length) return null
  const free = await suggestFreeSlots({ ...busy, date: args.date!, afterMs: startMs, durationMinutes: args.durationMinutes!, nowMs })
  return conflictReply(conflicts[0], free)
}

export async function decideRecordChange(input: {
  job: WaAssistantJob
  scope: AgentScope
  card: WaApproval
  actionType: ChangeType
  args: Args
  approve: boolean
  nowMs: number
  deps?: ChangeDecideDeps
}): Promise<MeetingReply> {
  const { job, scope, card, actionType, args, approve, nowMs } = input
  const decide = input.deps?.decide ?? decideOnAction

  // The slot may have filled since the card went out.
  if (approve && actionType === 'reschedule_meeting' && card.status === 'pending' && card.expiresAt.getTime() > nowMs) {
    const clash = await clashAtApproval(args, scope, nowMs)
    if (clash) {
      const closed = await decideWaApproval({ token: card.token, recipientId: job.recipientId, decision: 'rejected', now: new Date(nowMs) })
      if (closed.ok) await decide({ actionId: card.actionId, argsHash: card.argsHash, decision: 'REJECTED', scope, nowMs })
      return reply('answered', 'reschedule_meeting_conflict_at_approval', clash)
    }
  }

  const consumed = await decideWaApproval({ token: card.token, recipientId: job.recipientId, decision: approve ? 'approved' : 'rejected', now: new Date(nowMs) })
  if (consumed.ok === false) {
    const text =
      consumed.reason === 'expired' ? CHANGE_COPY.expired : consumed.reason === 'superseded' ? CHANGE_COPY.superseded : consumed.reason === 'already_decided' ? CHANGE_COPY.alreadyDecided : CHANGE_COPY.notFound
    return reply('refused', `decision_${consumed.reason}`, text)
  }
  const decided = await decide({ actionId: card.actionId, argsHash: card.argsHash, decision: approve ? 'APPROVED' : 'REJECTED', scope, nowMs })
  if (decided.ok === false) {
    return decided.reason === 'agent-disabled' ? reply('refused', 'decision_agent_disabled', COPY.notAvailable) : reply('refused', `decision_${decided.reason}`, CHANGE_COPY.changed)
  }
  if (!approve) return reply('answered', `${actionType}_rejected`, CHANGE_COPY.rejected)
  return reportOutcome(decided.outcome, input)
}

async function reportOutcome(outcome: ActionOutcome, input: Parameters<typeof decideRecordChange>[0]): Promise<MeetingReply> {
  const { actionType: type, args, scope } = input
  if (outcome.report === 'VERIFIED_SUCCESS' || outcome.report === 'DUPLICATE_NOOP') {
    const already = outcome.report === 'DUPLICATE_NOOP'
    const lead = await leadName(args.clientId, scope.agencyId)
    if (type === 'update_task' || type === 'complete_task') {
      const task = (await db('tasks as t')
        .join('clients as c', 'c.id', 't.clientId')
        .where({ 't.id': args.taskId, 'c.agencyId': scope.agencyId })
        .first('t.title', db.raw(`to_char(t."dueDate", 'YYYY-MM-DD') as "dueDate"`))) as { title: string; dueDate: string | null } | undefined
      if (!task) return reply('failed', `${type}_unverified`, CHANGE_COPY.unverified)
      return { status: 'answered', stopReason: already ? `${type}_already` : `${type}_done`, text: taskChangedReply({ type, already, lead, title: task.title, dueDate: task.dueDate }), headline: type === 'complete_task' ? 'המשימה סומנה כבוצעה' : 'המשימה עודכנה' }
    }
    const row = await getMeeting(args.meetingId!, scope.agencyId)
    if (!row) return reply('failed', `${type}_unverified`, CHANGE_COPY.unverified)
    const google = already ? 'not_connected' : await mirrorMeetingChange(row, scope, type === 'cancel_meeting' ? 'cancel' : 'reschedule', input.deps?.google)
    return {
      status: 'answered',
      stopReason: already ? `${type}_already` : `${type}_done_${google}`,
      text: meetingChangedReply({ type, already, lead, start: new Date(row.start_at), end: new Date(row.end_at), google }),
      headline: type === 'cancel_meeting' ? 'הפגישה בוטלה ב-SocialCRM' : 'הפגישה הוזזה ב-SocialCRM',
    }
  }
  if (outcome.report === 'EXECUTED_UNVERIFIED' || outcome.report === 'UNKNOWN_RECONCILE') return reply('failed', `${type}_${outcome.report.toLowerCase()}`, CHANGE_COPY.unverified)
  if (outcome.execution.status === 'NOT_AUTHORIZED') return reply('refused', `${type}_not_authorized`, CHANGE_COPY.notAuthorized)
  if (outcome.execution.reason === 'changed-since-card' || outcome.execution.reason === 'has-outcome') return reply('refused', `${type}_changed`, CHANGE_COPY.changed)
  return reply('failed', `${type}_${outcome.report.toLowerCase()}`, CHANGE_COPY.failed)
}
