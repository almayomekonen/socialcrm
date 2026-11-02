import 'server-only'
import { db } from '@/config/db'
import { decideOnAction } from '@/lib/agent/actions/bridge'
import { decideWaApproval, type WaApproval } from '@/db/waAssistantApprovals'
import { COPY } from '../render'
import type { AgentScope } from '@/lib/agent/types'
import type { ActionOutcome } from '@/lib/agent/actions'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { MeetingReply } from '../meetings/types'
import { TASK_COPY, taskSuccessReply } from './copy'

/**
 * A tap on "לאשר וליצור" / "לאשר ולקבוע" / "ביטול" for a task or follow-up card.
 *
 * The caller has already matched the token to THIS recipient and the stored
 * action (decideCard.ts). Here: the token is consumed in one guarded statement
 * (pending, unexpired, this recipient — a replay or an expired card does
 * nothing), then the decision goes through the EXISTING `decideOnAction`:
 * rollout re-check, proposer check, argsHash, the runtime's claim/lock, the
 * executor's own agency + rep-visibility check, and verification against the
 * persisted row. Nothing here writes a task or a follow-up.
 */

export type TaskDecideDeps = { decide?: typeof decideOnAction }

const reply = (status: MeetingReply['status'], stopReason: string, text: string | null): MeetingReply => ({
  status,
  stopReason,
  text,
  headline: null,
})

export async function decideTaskCard(input: {
  job: WaAssistantJob
  scope: AgentScope
  card: WaApproval
  actionType: 'create_task' | 'create_follow_up'
  args: { clientId: number; dueDate?: string; at?: string }
  approve: boolean
  nowMs: number
  deps?: TaskDecideDeps
}): Promise<MeetingReply> {
  const { job, scope, card, approve, nowMs } = input
  const kind = input.actionType === 'create_task' ? 'task' : 'follow_up'

  const consumed = await decideWaApproval({
    token: card.token,
    recipientId: job.recipientId,
    decision: approve ? 'approved' : 'rejected',
    now: new Date(nowMs),
  })
  if (consumed.ok === false) {
    const text =
      consumed.reason === 'expired'
        ? TASK_COPY.expired
        : consumed.reason === 'superseded'
          ? TASK_COPY.superseded
          : consumed.reason === 'already_decided'
            ? TASK_COPY.alreadyDecided
            : TASK_COPY.notFound
    return reply('refused', `decision_${consumed.reason}`, text)
  }

  const decided = await (input.deps?.decide ?? decideOnAction)({
    actionId: card.actionId,
    argsHash: card.argsHash,
    decision: approve ? 'APPROVED' : 'REJECTED',
    scope,
    nowMs,
  })
  if (decided.ok === false) {
    return decided.reason === 'agent-disabled'
      ? reply('refused', 'decision_agent_disabled', COPY.notAvailable)
      : reply('refused', `decision_${decided.reason}`, TASK_COPY.changed)
  }
  if (!approve) return reply('answered', `${kind}_rejected`, TASK_COPY.rejected)
  return reportOutcome(decided.outcome, kind, input.args, scope)
}

async function reportOutcome(
  outcome: ActionOutcome,
  kind: 'task' | 'follow_up',
  args: { clientId: number; dueDate?: string; at?: string },
  scope: AgentScope,
): Promise<MeetingReply> {
  if (outcome.report === 'VERIFIED_SUCCESS' || outcome.report === 'DUPLICATE_NOOP') {
    const lead = (await db('clients').where({ id: args.clientId, agencyId: scope.agencyId }).first('firstName', 'lastName')) as
      | { firstName: string | null; lastName: string | null }
      | undefined
    if (!lead) return reply('failed', `${kind}_unverified`, TASK_COPY.unverified)
    const already = outcome.report === 'DUPLICATE_NOOP'
    const text = taskSuccessReply({
      kind,
      already,
      lead: [lead.firstName, lead.lastName].filter(Boolean).join(' '),
      date: (kind === 'task' ? args.dueDate : args.at) ?? '',
    })
    return {
      status: 'answered',
      stopReason: already ? `${kind}_already_created` : `${kind}_created`,
      text,
      headline: kind === 'task' ? 'המשימה נוצרה ב-SocialCRM' : 'המעקב נקבע ב-SocialCRM',
    }
  }
  if (outcome.report === 'EXECUTED_UNVERIFIED' || outcome.report === 'UNKNOWN_RECONCILE')
    return reply('failed', `${kind}_${outcome.report.toLowerCase()}`, TASK_COPY.unverified)
  if (outcome.execution.status === 'NOT_AUTHORIZED') return reply('refused', `${kind}_not_authorized`, TASK_COPY.notAuthorized)
  return reply('failed', `${kind}_${outcome.report.toLowerCase()}`, TASK_COPY.failed)
}
