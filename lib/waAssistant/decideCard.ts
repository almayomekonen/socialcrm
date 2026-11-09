import 'server-only'
import { findActionByActionId } from '@/db/agentActions'
import { decideWaApproval, peekWaApproval } from '@/db/waAssistantApprovals'
import { COPY } from './render'
import { decideMeeting, type DecideDeps } from './meetings/decide'
import { DECISION_ID_RE, MEETING_COPY } from './meetings/copy'
import { decideTaskCard, type TaskDecideDeps } from './tasks/decide'
import { TASK_COPY } from './tasks/copy'
import { decideLeadUpdateCard, type LeadUpdateDecideDeps } from './leadUpdates/decide'
import type { AgentScope } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { MeetingReply } from './meetings/types'
import { decideReminderCard, opOfAction } from './reminders/decide'
import { REMINDER_COPY } from './reminders/copy'
import type { ReminderDeps } from './reminders/reply'
import { decideQuoteCard, type QuoteDecideDeps } from './quotes/decide'
import { QUOTE_COPY } from './quotes/copy'
import { decideRecordChange, type ChangeDecideDeps } from './recordChanges/decide'
import { CHANGE_COPY, type ChangeType } from './recordChanges/copy'

/**
 * A tap on any confirmation card's button, routed by the STORED action's type:
 * meetings to the existing `decideMeeting` (unchanged), tasks and follow-ups to
 * `decideTaskCard`, quotes to `decideQuoteCard`, changes to an existing task or
 * appointment to `decideRecordChange`. No model runs here, so a tap is never an
 * agent request (db/credits/agentRequests.ts). Each capability needs its own per-agency switch at the
 * moment of the tap, so turning one off also stops its pending cards.
 */
const refused = (stopReason: string, text: string | null): MeetingReply => ({
  status: 'refused',
  stopReason,
  text,
  headline: null,
})


const isChangeType = (t: string): t is ChangeType => t === 'update_task' || t === 'complete_task' || t === 'reschedule_meeting' || t === 'cancel_meeting'
export async function decideCard(input: {
  job: WaAssistantJob
  scope: AgentScope
  nowMs: number
  meetingsOn: boolean
  tasksOn: boolean
  statusOn?: boolean
  notesOn?: boolean
  remindersOn?: boolean
  quotesOn?: boolean
  deps?: { meetings?: DecideDeps; tasks?: TaskDecideDeps; leadUpdates?: LeadUpdateDecideDeps; reminders?: ReminderDeps; quotes?: QuoteDecideDeps; changes?: ChangeDecideDeps }
}): Promise<MeetingReply> {
  const { job, scope, nowMs } = input
  const m = DECISION_ID_RE.exec(job.question ?? '')
  if (!m) return refused('decision_malformed', null)

  const card = await peekWaApproval(m[2], job.recipientId)
  if (!card || card.agencyId !== scope.agencyId || card.userId !== scope.userId)
    return refused('decision_not_found', MEETING_COPY.notFound)
  const record = await findActionByActionId(scope.agencyId, card.actionId)

  if (record?.actionType === 'create_meeting') {
    return input.meetingsOn
      ? decideMeeting({ job, scope, nowMs, deps: input.deps?.meetings })
      : refused('meetings_disabled', COPY.notAvailable)
  }
  if (record?.actionType === 'create_task' || record?.actionType === 'create_follow_up') {
    if (!input.tasksOn) return refused('tasks_disabled', COPY.notAvailable)
    if (record.argsHash !== card.argsHash) {
      await decideWaApproval({ token: card.token, recipientId: job.recipientId, decision: 'rejected', now: new Date(nowMs) })
      return refused('decision_args_changed', TASK_COPY.changed)
    }
    return decideTaskCard({
      job,
      scope,
      card,
      actionType: record.actionType,
      args: record.args as { clientId: number; dueDate?: string; at?: string },
      approve: m[1] === 'approve',
      nowMs,
      deps: input.deps?.tasks,
    })
  }
  if (record?.actionType === 'update_lead_status' || record?.actionType === 'add_lead_note') {
    const on = record.actionType === 'update_lead_status' ? input.statusOn : input.notesOn
    if (!on) return refused(record.actionType === 'update_lead_status' ? 'status_disabled' : 'notes_disabled', COPY.notAvailable)
    if (record.argsHash !== card.argsHash) {
      await decideWaApproval({ token: card.token, recipientId: job.recipientId, decision: 'rejected', now: new Date(nowMs) })
      return refused('decision_args_changed', TASK_COPY.changed)
    }
    return decideLeadUpdateCard({
      job,
      scope,
      card,
      actionType: record.actionType,
      args: record.args as { clientId: number; status?: string },
      approve: m[1] === 'approve',
      nowMs,
      deps: input.deps?.leadUpdates,
    })
  }
  if (record?.actionType === 'create_quote') {
    if (!input.quotesOn) return refused('quotes_disabled', COPY.notAvailable)
    if (record.argsHash !== card.argsHash) {
      await decideWaApproval({ token: card.token, recipientId: job.recipientId, decision: 'rejected', now: new Date(nowMs) })
      return refused('decision_args_changed', QUOTE_COPY.changed)
    }
    return decideQuoteCard({
      job,
      scope,
      card,
      args: record.args as { clientId: number },
      approve: m[1] === 'approve',
      nowMs,
      deps: input.deps?.quotes,
    })
  }
  if (record && isChangeType(record.actionType)) {
    const on = record.actionType === 'update_task' || record.actionType === 'complete_task' ? input.tasksOn : input.meetingsOn
    if (!on) return refused('record_change_disabled', COPY.notAvailable)
    if (record.argsHash !== card.argsHash) {
      await decideWaApproval({ token: card.token, recipientId: job.recipientId, decision: 'rejected', now: new Date(nowMs) })
      return refused('decision_args_changed', CHANGE_COPY.changed)
    }
    return decideRecordChange({ job, scope, card, actionType: record.actionType, args: record.args as Parameters<typeof decideRecordChange>[0]['args'], approve: m[1] === 'approve', nowMs, deps: input.deps?.changes })
  }
  const reminderOp = record ? opOfAction(record.actionType) : null
  if (record && reminderOp) {
    if (!input.remindersOn) return refused('reminders_disabled', COPY.notAvailable)
    if (record.argsHash !== card.argsHash) {
      await decideWaApproval({ token: card.token, recipientId: job.recipientId, decision: 'rejected', now: new Date(nowMs) })
      return refused('decision_args_changed', REMINDER_COPY.changed)
    }
    return decideReminderCard({
      job,
      scope,
      card,
      op: reminderOp,
      args: record.args as { reminderId?: number },
      approve: m[1] === 'approve',
      nowMs,
      deps: input.deps?.reminders,
    })
  }
  await decideWaApproval({ token: card.token, recipientId: job.recipientId, decision: 'rejected', now: new Date(nowMs) })
  return refused('decision_args_changed', TASK_COPY.changed)
}
