import 'server-only'
import { decideOnAction } from '@/lib/agent/actions/bridge'
import { findActionByActionId } from '@/db/agentActions'
import { getMeeting, type MeetingRow } from '@/db/meetings'
import { pushMeetingToGoogle } from '@/actions/calendar/shared'
import { businessDateString, businessInstantMs } from '@/lib/today/time'
import { decideWaApproval, peekWaApproval } from '@/db/waAssistantApprovals'
import { db } from '@/config/db'
import { COPY } from '../render'
import type { AgentScope } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { ActionOutcome } from '@/lib/agent/actions'
import { findMeetingConflicts, suggestFreeSlots } from './conflicts'
import { DECISION_ID_RE, MEETING_COPY, conflictReply, successReply, type GoogleState } from './copy'
import { googleCalendarConnected } from './propose'
import type { MeetingReply } from './types'

/**
 * A tap on "לאשר ולקבוע" / "ביטול".
 *
 * The button carries only an opaque token. It must belong to THIS recipient, be
 * pending and unexpired, and name an action whose stored argsHash still matches;
 * it is consumed in one guarded statement (a replay finds it decided). The
 * decision then goes through the EXISTING `decideOnAction` — proposer check,
 * argsHash check, rollout re-check, the Action Runtime's claim/lock, the
 * create_meeting executor's own agency + rep-visibility check, and its
 * verification against the persisted row. Nothing here writes a meeting.
 *
 * After a VERIFIED meeting, and only then, the meeting is pushed to Google once
 * (the executor deliberately leaves it `pending`), without attendees, so no
 * invitation reaches anyone. Google's insert has no idempotency key, so the
 * push is never retried here; the reply reports the row's real sync state.
 */

const GOOGLE_PUSH_BUDGET_MS = 15_000

export type DecideDeps = {
  decide?: typeof decideOnAction
  pushGoogle?: typeof pushMeetingToGoogle
}

type MeetingArgs = { clientId: number; date: string; startTime: string; durationMinutes: number }

const reply = (status: MeetingReply['status'], stopReason: string, text: string | null): MeetingReply => ({ status, stopReason, text, headline: null })

export async function decideMeeting(input: { job: WaAssistantJob; scope: AgentScope; nowMs: number; deps?: DecideDeps }): Promise<MeetingReply> {
  const { job, scope, nowMs } = input
  const m = DECISION_ID_RE.exec(job.question ?? '')
  if (!m) return reply('refused', 'decision_malformed', null)
  const approve = m[1] === 'approve'
  const token = m[2]

  const card = await peekWaApproval(token, job.recipientId)
  if (!card || card.agencyId !== scope.agencyId || card.userId !== scope.userId) return reply('refused', 'decision_not_found', MEETING_COPY.notFound)

  const record = await findActionByActionId(scope.agencyId, card.actionId)
  if (!record || record.argsHash !== card.argsHash || record.actionType !== 'create_meeting') {
    await decideWaApproval({ token, recipientId: job.recipientId, decision: 'rejected', now: new Date(nowMs) })
    return reply('refused', 'decision_args_changed', MEETING_COPY.changed)
  }
  const args = record.args as MeetingArgs

  // Availability again, right before the write: the slot may have filled since the card.
  if (approve && card.status === 'pending' && card.expiresAt.getTime() > nowMs) {
    const startMs = businessInstantMs(args.date, args.startTime)
    const conflicts = await findMeetingConflicts({ agencyId: scope.agencyId, organizerUserId: scope.userId, startAt: new Date(startMs), endAt: new Date(startMs + args.durationMinutes * 60_000) })
    if (conflicts.length) {
      const closed = await decideWaApproval({ token, recipientId: job.recipientId, decision: 'rejected', now: new Date(nowMs) })
      if (closed.ok) await (input.deps?.decide ?? decideOnAction)({ actionId: card.actionId, argsHash: card.argsHash, decision: 'REJECTED', scope, nowMs })
      const free = await suggestFreeSlots({ agencyId: scope.agencyId, organizerUserId: scope.userId, date: args.date, afterMs: startMs, durationMinutes: args.durationMinutes, nowMs })
      return reply('answered', 'meeting_conflict_at_approval', conflictReply(conflicts[0], free))
    }
  }

  const consumed = await decideWaApproval({ token, recipientId: job.recipientId, decision: approve ? 'approved' : 'rejected', now: new Date(nowMs) })
  if (consumed.ok === false) {
    const text = consumed.reason === 'expired' ? MEETING_COPY.expired : consumed.reason === 'superseded' ? MEETING_COPY.superseded : consumed.reason === 'already_decided' ? MEETING_COPY.alreadyDecided : MEETING_COPY.notFound
    return reply('refused', `decision_${consumed.reason}`, text)
  }

  const decided = await (input.deps?.decide ?? decideOnAction)({ actionId: card.actionId, argsHash: card.argsHash, decision: approve ? 'APPROVED' : 'REJECTED', scope, nowMs })
  if (decided.ok === false) {
    return decided.reason === 'agent-disabled' ? reply('refused', 'decision_agent_disabled', COPY.notAvailable) : reply('refused', `decision_${decided.reason}`, MEETING_COPY.changed)
  }
  if (!approve) return reply('answered', 'meeting_rejected', MEETING_COPY.rejected)
  return reportOutcome(decided.outcome, args, scope, input.deps)
}

function meetingIdOf(outcome: ActionOutcome): number | null {
  const t = [...(outcome.verification?.targetIds ?? []), ...(outcome.execution.targetIds ?? [])].find((x) => x.kind === 'meeting')
  return t ? Number(t.id) : null
}

async function reportOutcome(outcome: ActionOutcome, args: MeetingArgs, scope: AgentScope, deps?: DecideDeps): Promise<MeetingReply> {
  if (outcome.report === 'VERIFIED_SUCCESS' || outcome.report === 'DUPLICATE_NOOP') {
    const id = meetingIdOf(outcome)
    const row = id ? await getMeeting(id, scope.agencyId) : null
    if (!row || row.status !== 'scheduled') return reply('failed', 'meeting_unverified', MEETING_COPY.unverified)
    const already = outcome.report === 'DUPLICATE_NOOP'
    const google = already ? await googleStateOf(row, scope) : await syncToGoogle(row, scope, deps)
    const final = (await getMeeting(row.id, scope.agencyId)) ?? row
    const text = successReply({ already, lead: await leadName(final.lead_id ?? args.clientId, scope.agencyId), start: new Date(final.start_at), end: new Date(final.end_at), date: businessDateString(new Date(final.start_at).getTime()), google })
    return { status: 'answered', stopReason: already ? 'meeting_already_created' : `meeting_created_${google}`, text, headline: 'הפגישה נקבעה ב-SocialCRM' }
  }
  if (outcome.report === 'EXECUTED_UNVERIFIED' || outcome.report === 'UNKNOWN_RECONCILE') return reply('failed', `meeting_${outcome.report.toLowerCase()}`, MEETING_COPY.unverified)
  if (outcome.execution.status === 'NOT_AUTHORIZED') return reply('refused', 'meeting_not_authorized', MEETING_COPY.notAuthorized)
  return reply('failed', `meeting_${outcome.report.toLowerCase()}`, MEETING_COPY.failed)
}

async function googleStateOf(row: MeetingRow, scope: AgentScope): Promise<GoogleState> {
  if (row.sync_status === 'synced') return 'synced'
  if (!(await googleCalendarConnected(scope.userId))) return 'not_connected'
  return row.sync_status === 'pending' ? 'unconfirmed' : row.sync_status
}

/** One push, only for a fresh `pending` row of a connected organizer, bounded in time; the answer is the re-read row. */
async function syncToGoogle(row: MeetingRow, scope: AgentScope, deps?: DecideDeps): Promise<GoogleState> {
  if (!(await googleCalendarConnected(scope.userId))) return 'not_connected'
  if (row.sync_status !== 'pending' || row.google_event_id) return googleStateOf(row, scope)
  let timer: ReturnType<typeof setTimeout> | undefined
  const push = (deps?.pushGoogle ?? pushMeetingToGoogle)({
    meetingId: row.id,
    userId: scope.userId,
    title: row.title,
    description: row.description,
    location: row.location,
    startAt: new Date(row.start_at),
    endAt: new Date(row.end_at),
    timezone: row.timezone,
    attendees: [],
  }).catch(() => null)
  await Promise.race([push, new Promise((r) => (timer = setTimeout(r, GOOGLE_PUSH_BUDGET_MS)))])
  clearTimeout(timer)
  const after = await getMeeting(row.id, scope.agencyId)
  return after ? googleStateOf(after, scope) : 'unconfirmed'
}

async function leadName(leadId: number, agencyId: number): Promise<string> {
  const row = (await db('clients').where({ id: leadId, agencyId }).first('firstName', 'lastName')) as { firstName: string | null; lastName: string | null } | undefined
  return row ? [row.firstName, row.lastName].filter(Boolean).join(' ') : ''
}
