import 'server-only'
import { submitProposedAction } from '@/lib/agent/actions/bridge'
import { ensureWaApprovalForAction } from '@/db/waAssistantApprovals'
import { createReminderDraft } from '@/db/ownerPersonalReminders/draft'
import { businessDateString } from '@/lib/today/time'
import { readReminderWhen } from '@/lib/reminders/when'
import { mentionsWhen, mergeWhen, reminderText, stripDates, stripTimes } from '@/lib/reminders/request'
import type { AgentScope } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { MeetingReply } from '../meetings/types'
import type { ReminderRequest } from './conversation'
import { REMINDER_COPY, REMINDER_TEXT_MAX, alreadyScheduled, createCard, dailyLimit, reminderWhenQuestion } from './copy'
import { cardFor, clarify, plain, type ReminderDeps } from './reply'

/**
 * "בעוד 5 דקות תזכיר לי להתקשר לאבי" → a confirmation card, or ONE question.
 *
 * NOTHING IS SCHEDULED HERE (architecture v1.4–v1.6.1). In order:
 *   1. consent v5 and an active recipient (the draft re-checks it under lock);
 *   2. WHAT: the owner's own words, without the trigger and the time words;
 *   3. WHEN: lib/reminders/when.ts, from the owner's words and the Meta
 *      timestamp of the message that said it. Unverified → no card. Unclear,
 *      passed, too soon, beyond 23 h → one question;
 *   4. T0: the draft row, ONE per owner message for life;
 *   5. the Action Runtime records `create_reminder` as AWAITING_APPROVAL, under
 *      the deterministic id `rem_<id>_v1_create` (application-proposed: the
 *      model never names it, and the text never enters the action's args);
 *   6. one approval token per action for life, and the card.
 *
 * The recipient is ALWAYS the owner who wrote: the draft is bound to this job's
 * recipient row. A name in the text ("לאבי") is only text; nothing is looked up.
 */

/** What the owner said, and when, from the whole request. */
function readRequest(req: ReminderRequest): { text: string; when: string; anchor: { ts: number; source: 'meta' | 'server' | null } } {
  const [first, ...answers] = req.messages
  const today = businessDateString(first.ts * 1000)
  let text = reminderText(first.text)
  let when = first.text
  let anchor = { ts: first.ts, source: first.source }
  for (const a of answers) {
    if (a.asked?.endsWith('_text')) {
      if (!text) text = reminderText(stripDates(stripTimes(a.text)))
      if (!mentionsWhen(a.text, today)) continue
    }
    when = mergeWhen(when, a.text, today)
    anchor = { ts: a.ts, source: a.source }
  }
  return { text, when, anchor }
}

export async function proposeReminder(input: { job: WaAssistantJob; scope: AgentScope; req: ReminderRequest; recipientConsentOk: boolean; nowMs: number; deps?: ReminderDeps }): Promise<MeetingReply> {
  const { job, scope, req, nowMs } = input
  if (!input.recipientConsentOk) return plain('reminder_consent_required', REMINDER_COPY.consent)

  const { text, when, anchor } = readRequest(req)
  const read = readReminderWhen(when, { messageTimestampSec: anchor.ts, source: anchor.source }, nowMs)
  if (read.ok === false && read.ask === 'unverified_anchor') return plain('reminder_unverified_anchor', REMINDER_COPY.unverified)
  if (!text) return clarify('create', 'text', REMINDER_COPY.askText)
  if ([...text].length > REMINDER_TEXT_MAX) return plain('reminder_text_too_long', REMINDER_COPY.tooLong)
  if (read.ok === false) return clarify('create', read.ask, reminderWhenQuestion(read.ask, { hour: read.hour, anchorMs: anchor.ts * 1000 }))

  const draft = await createReminderDraft({
    owner: { agencyId: scope.agencyId, userId: scope.userId },
    recipientId: job.recipientId,
    text,
    remindAtMs: read.remindAtMs,
    anchorSec: anchor.ts,
    sourceWamid: job.wamid,
    sourceJobId: job.id,
    nowMs,
  })
  if (draft.kind === 'consent') return plain('reminder_consent_required', REMINDER_COPY.consent)
  if (draft.kind === 'limit') return plain(`reminder_${draft.reason}`, draft.reason === 'scheduled_limit' ? REMINDER_COPY.scheduledLimit : dailyLimit(read.remindAtMs))
  if (draft.kind === 'already_scheduled') return plain('reminder_already_scheduled', alreadyScheduled(draft.remindAtMs, nowMs))
  if (draft.kind === 'handled') return plain('reminder_request_already_handled', REMINDER_COPY.handled)

  const outcome = await (input.deps?.submit ?? submitProposedAction)({
    proposal: { actionType: 'create_reminder', args: { reminderId: draft.reminderId, version: draft.version, remindAt: new Date(draft.remindAtMs).toISOString() }, evidenceRefs: [`reminder:${draft.reminderId}`] },
    scope,
    agentRunId: `wa_job_${job.id}`,
    identity: { actionId: draft.actionId, idempotencyKey: draft.actionId },
  })
  return cardFor({ job, scope, nowMs, op: 'create', actionId: draft.actionId, outcome, reused: draft.reused, text: createCard({ text, atMs: draft.remindAtMs, fromMs: anchor.ts * 1000 }), ensure: input.deps?.ensure ?? ensureWaApprovalForAction })
}

