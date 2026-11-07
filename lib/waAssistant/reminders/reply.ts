import 'server-only'
import type { submitProposedAction, decideOnAction } from '@/lib/agent/actions/bridge'
import type { ensureWaApprovalForAction } from '@/db/waAssistantApprovals'
import type { AgentScope } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { MeetingReply } from '../meetings/types'
import { REMINDER_CLARIFY } from './conversation'
import { REMINDER_COPY, reminderButtons } from './copy'

/** Shared reply shapes for the personal-reminder flows (Phase 6). */

export type ReminderDeps = {
  submit?: typeof submitProposedAction
  ensure?: typeof ensureWaApprovalForAction
  decide?: typeof decideOnAction
}

export const plain = (stopReason: string, text: string, status: MeetingReply['status'] = 'answered'): MeetingReply => ({ status, stopReason, text, headline: null })

/**
 * ONE question. The stop reason `reminder_clarify_<op>_<why>` is what keeps the
 * request open for the owner's next message (./conversation.ts); the headline is
 * the question itself, never the reminder's text.
 */
export const clarify = (op: 'create' | 'cancel' | 'reschedule', why: string, text: string): MeetingReply => ({
  status: 'answered',
  stopReason: `${REMINDER_CLARIFY}${op}_${why}`,
  text,
  headline: text,
})

/**
 * The card for an action the Action Runtime recorded as awaiting approval.
 * A re-run of the same request reuses the same action and the same token
 * (ensureWaApprovalForAction); the worker's one-reply-per-job rule decides
 * whether anything is sent again (it is not).
 */
export async function cardFor(input: {
  job: WaAssistantJob
  scope: AgentScope
  nowMs: number
  op: 'create' | 'cancel' | 'reschedule'
  actionId: string
  outcome: Awaited<ReturnType<typeof submitProposedAction>>
  reused?: boolean
  text: string
  ensure: typeof ensureWaApprovalForAction
}): Promise<MeetingReply> {
  const { job, scope, outcome } = input
  const awaiting = outcome && outcome.actionId === input.actionId && (outcome.report === 'AWAITING_APPROVAL' || (input.reused && outcome.approval === 'PENDING'))
  if (!outcome || !awaiting) return plain(`reminder_${input.op}_propose_${outcome?.report ?? 'unparsed'}`, REMINDER_COPY.notPrepared, 'failed')
  const token = await input.ensure({
    recipientId: job.recipientId,
    agencyId: scope.agencyId,
    userId: scope.userId,
    jobId: job.id,
    actionId: input.actionId,
    argsHash: outcome.argsHash,
    now: new Date(input.nowMs),
  })
  if (token.kind === 'already_decided') return plain(`reminder_${input.op}_already_decided`, REMINDER_COPY.alreadyDecided)
  if (token.kind === 'terminal') return plain(`reminder_${input.op}_card_${token.status}`, REMINDER_COPY.noLongerValid)
  if (token.kind === 'no_recipient') return plain(`reminder_${input.op}_no_recipient`, REMINDER_COPY.notPrepared, 'failed')
  return {
    status: 'answered',
    stopReason: `reminder_${input.op}_awaiting_approval`,
    text: input.text,
    buttons: reminderButtons(token.token, input.op),
    headline: input.op === 'create' ? 'ממתין לאישור קביעת תזכורת' : input.op === 'cancel' ? 'ממתין לאישור ביטול תזכורת' : 'ממתין לאישור הזזת תזכורת',
  }
}
