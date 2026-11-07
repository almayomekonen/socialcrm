import 'server-only'
import { decideOnAction } from '@/lib/agent/actions/bridge'
import { decideWaApproval, type WaApproval } from '@/db/waAssistantApprovals'
import { discardRejectedDraft, readOwnReminder } from '@/db/ownerPersonalReminders/draft'
import { reminderDeliveryAvailable } from '@/lib/reminders/delivery/available'
import { COPY } from '../render'
import type { ActionOutcome } from '@/lib/agent/actions'
import type { AgentScope } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { MeetingReply } from '../meetings/types'
import { REMINDER_COPY, doneReply } from './copy'
import { plain, type ReminderDeps } from './reply'

/**
 * A tap on a personal-reminder card (create / cancel / reschedule).
 *
 * The caller matched the token to THIS recipient, this scope and the stored
 * action, and checked its argsHash (../decideCard.ts). Here: the token is
 * consumed in one guarded statement, then the EXISTING `decideOnAction` runs the
 * decision (rollout re-check, argsHash, the runtime's claim, the executor's own
 * lock-ordered ownership and version checks, verification by reading the row
 * back). Nothing here schedules, cancels or moves a reminder itself.
 *
 * "Now" for the lead-time rule is the later of the server clock and the tap's
 * VERIFIED Meta time (architecture v1.6 §3).
 */

export type ReminderOp = 'create' | 'cancel' | 'reschedule'
export const opOfAction = (actionType: string): ReminderOp | null =>
  actionType === 'create_reminder' ? 'create' : actionType === 'cancel_reminder' ? 'cancel' : actionType === 'reschedule_reminder' ? 'reschedule' : null

export async function decideReminderCard(input: {
  job: WaAssistantJob
  scope: AgentScope
  card: WaApproval
  op: ReminderOp
  args: { reminderId?: number }
  approve: boolean
  nowMs: number
  deps?: ReminderDeps
}): Promise<MeetingReply> {
  const { job, scope, card, op, approve } = input
  const tapMs = job.timestampSource === 'meta' ? job.messageTimestamp * 1000 : 0
  const nowMs = Math.max(input.nowMs, tapMs)

  const consumed = await decideWaApproval({ token: card.token, recipientId: job.recipientId, decision: approve ? 'approved' : 'rejected', now: new Date(input.nowMs) })
  if (consumed.ok === false) {
    const text =
      consumed.reason === 'expired' ? REMINDER_COPY.expired
      : consumed.reason === 'superseded' ? REMINDER_COPY.superseded
      : consumed.reason === 'already_decided' ? REMINDER_COPY.alreadyDecided
      : REMINDER_COPY.notFound
    return plain(`decision_${consumed.reason}`, text, 'refused')
  }

  const decided = await (input.deps?.decide ?? decideOnAction)({ actionId: card.actionId, argsHash: card.argsHash, decision: approve ? 'APPROVED' : 'REJECTED', scope, nowMs })
  if (decided.ok === false) {
    return decided.reason === 'agent-disabled' ? plain('decision_agent_disabled', COPY.notAvailable, 'refused') : plain(`decision_${decided.reason}`, REMINDER_COPY.changed, 'refused')
  }
  const reminderId = Number(input.args.reminderId)
  const owner = { agencyId: scope.agencyId, userId: scope.userId }
  if (!approve) {
    if (op === 'create' && Number.isSafeInteger(reminderId)) await discardRejectedDraft({ reminderId, owner, actionId: card.actionId, nowMs })
    return plain(`reminder_${op}_rejected`, op === 'create' ? REMINDER_COPY.rejected : REMINDER_COPY.kept)
  }
  return report(decided.outcome, op, reminderId, owner, nowMs, input.deps?.deliveryAvailable ?? reminderDeliveryAvailable)
}

const REASON_COPY: Record<string, string> = {
  'rejected:due_passed': REMINDER_COPY.tooLate,
  'rejected:lead_time': REMINDER_COPY.tooLate,
  'rejected:horizon': REMINDER_COPY.tooLate,
  'rejected:forecast': REMINDER_COPY.overLimit,
  'rejected:consent': REMINDER_COPY.consent,
  consent: REMINDER_COPY.consent,
  in_flight: REMINDER_COPY.inFlight,
  already_sent: REMINDER_COPY.alreadySent,
  already_final: REMINDER_COPY.notCancellable,
  not_scheduled: REMINDER_COPY.notCancellable,
  not_reschedulable: REMINDER_COPY.notCancellable,
  stale_version: REMINDER_COPY.changed,
  draft_unavailable: REMINDER_COPY.noLongerValid,
  args_mismatch: REMINDER_COPY.noLongerValid,
  scheduled_by_other: REMINDER_COPY.noLongerValid,
}

async function report(outcome: ActionOutcome, op: ReminderOp, reminderId: number, owner: { agencyId: number; userId: number }, nowMs: number, deliveryAvailable: () => Promise<boolean>): Promise<MeetingReply> {
  if (outcome.report === 'VERIFIED_SUCCESS' || outcome.report === 'DUPLICATE_NOOP') {
    const row = await readOwnReminder(owner, reminderId)
    if (!row) return plain(`reminder_${op}_unverified`, REMINDER_COPY.unverifiedOutcome, 'failed')
    const detail = (outcome.execution as { detail?: Record<string, unknown> }).detail ?? {}
    const already = outcome.report === 'DUPLICATE_NOOP' || detail.replayed === true || detail.alreadyCancelled === true
    const done = op === 'create' ? 'reminder_scheduled' : op === 'cancel' ? 'reminder_cancelled' : 'reminder_rescheduled'
    return { status: 'answered', stopReason: already ? `${done}_already` : done, text: doneReply(op, { text: row.text, atMs: row.remindAtMs, fromMs: nowMs, already, delivery: op === 'cancel' ? undefined : await deliveryAvailable() }), headline: op === 'create' ? 'התזכורת נקבעה' : op === 'cancel' ? 'התזכורת בוטלה' : 'התזכורת הוזזה' }
  }
  if (outcome.report === 'EXECUTED_UNVERIFIED' || outcome.report === 'UNKNOWN_RECONCILE') return plain(`reminder_${op}_${outcome.report.toLowerCase()}`, REMINDER_COPY.unverifiedOutcome, 'failed')
  if (outcome.execution.status === 'NOT_AUTHORIZED') return plain(`reminder_${op}_not_authorized`, REMINDER_COPY.notFound, 'refused')
  const reason = 'reason' in outcome.execution ? String((outcome.execution as { reason?: string }).reason ?? '') : ''
  return plain(`reminder_${op}_${(reason || outcome.report).toLowerCase().replace(/[^a-z_]/g, '_')}`, REASON_COPY[reason] ?? REMINDER_COPY.failed, 'failed')
}
