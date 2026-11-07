import 'server-only'
import { submitProposedAction } from '@/lib/agent/actions/bridge'
import { ensureWaApprovalForAction } from '@/db/waAssistantApprovals'
import { listUpcomingReminders, type ReminderView } from '@/db/ownerPersonalReminders/draft'
import { reminderActionId } from '@/lib/reminders/limits'
import { readReminderWhen } from '@/lib/reminders/when'
import { readClock } from '@/lib/reminders/clock'
import { mentionsWhen, squash, targetPhrase, targetTime } from '@/lib/reminders/request'
import { businessDateString } from '@/lib/today/time'
import type { AgentScope } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import type { MeetingReply } from '../meetings/types'
import type { ReminderRequest } from './conversation'
import { REMINDER_COPY, cancelCard, listReply, reminderLines, reminderWhenQuestion, rescheduleCard, whenLabel } from './copy'
import { cardFor, clarify, plain, type ReminderDeps } from './reply'

/**
 * List, cancel and reschedule the owner's OWN upcoming reminders (Phase 6).
 *
 * Every read is scoped to `agencyId` AND `userId` of the authenticated scope
 * (db/ownerPersonalReminders/draft.ts), so a reminder of another owner or another
 * agency can never be listed, named or proposed. The executors re-check the same
 * ownership under lock (T4/T6), and the card is bound to the reminder's version,
 * so an outdated card changes nothing.
 *
 * WHICH reminder: the words the owner used ("להתקשר לאבי") and/or its time
 * ("של 14:35"); the only upcoming reminder when nothing narrows it. Several
 * matches → the owner chooses; never us.
 */

type Owner = { agencyId: number; userId: number }
const ownerOf = (scope: AgentScope): Owner => ({ agencyId: scope.agencyId, userId: scope.userId })

const wall = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(ms))

/**
 * The upcoming reminders the owner's words point at. With nothing that narrows
 * it, a follow-up to the reminder just handled ("תבטל אותה") means the one most
 * recently changed; the card still shows which, before anything happens.
 */
export function matchReminders(rows: ReminderView[], phrase: string, time: string | null, recent = false): ReminderView[] {
  if (recent && !phrase && !time && rows.length > 1) return [rows.reduce((a, b) => (b.updatedAtMs > a.updatedAtMs ? b : a))]
  let found = rows
  if (time) found = found.filter((r) => wall(r.remindAtMs) === time)
  const p = squash(phrase)
  if (p) found = found.filter((r) => !!r.text && (squash(r.text).includes(p) || p.includes(squash(r.text))))
  return found
}

export async function listReminders(input: { scope: AgentScope; consentOk: boolean; nowMs: number }): Promise<MeetingReply> {
  if (!input.consentOk) return plain('reminder_consent_required', REMINDER_COPY.consent)
  const rows = await listUpcomingReminders(ownerOf(input.scope))
  return { status: 'answered', stopReason: rows.length ? 'reminder_listed' : 'reminder_list_empty', text: listReply(rows, input.nowMs), headline: rows.length ? `${rows.length} תזכורות קרובות` : 'אין תזכורות קרובות' }
}

const several = (rows: ReminderView[], nowMs: number, ask: string) => ['יש כמה תזכורות שמתאימות:', ...reminderLines(rows, nowMs), ask].join('\n')
const noMatch = (rows: ReminderView[], nowMs: number) => `${REMINDER_COPY.noMatch}\n\n${listReply(rows, nowMs)}`

export async function proposeCancel(input: { job: WaAssistantJob; scope: AgentScope; req: ReminderRequest; consentOk: boolean; nowMs: number; deps?: ReminderDeps }): Promise<MeetingReply> {
  const { job, scope, nowMs } = input
  if (!input.consentOk) return plain('reminder_consent_required', REMINDER_COPY.consent)
  const said = input.req.messages.map((m) => m.text).join(' ')
  const rows = await listUpcomingReminders(ownerOf(scope), 50)
  if (!rows.length) return plain('reminder_cancel_none', REMINDER_COPY.none)
  const clock = readClock(said)
  const explicit = targetTime(said).time
  const time = explicit ?? (clock.times.length === 1 ? clock.times[0] : null)
  const phrase = targetPhrase(said)
  const found = matchReminders(rows, phrase, time, input.req.recent)
  if (!found.length) return plain('reminder_cancel_no_match', noMatch(rows, nowMs))
  if (found.length > 1) return clarify('cancel', 'target', several(found, nowMs, REMINDER_COPY.askWhichCancel))

  const r = found[0]
  const actionId = reminderActionId('cancel', r.id, r.version, job.id)
  const outcome = await (input.deps?.submit ?? submitProposedAction)({
    proposal: { actionType: 'cancel_reminder', args: { reminderId: r.id, version: r.version }, evidenceRefs: [`reminder:${r.id}`] },
    scope,
    agentRunId: `wa_job_${job.id}`,
    identity: { actionId, idempotencyKey: actionId },
  })
  return cardFor({ job, scope, nowMs, op: 'cancel', actionId, outcome, reused: true, text: cancelCard({ text: r.text, atMs: r.remindAtMs, fromMs: nowMs }), ensure: input.deps?.ensure ?? ensureWaApprovalForAction })
}

export async function proposeReschedule(input: { job: WaAssistantJob; scope: AgentScope; req: ReminderRequest; consentOk: boolean; nowMs: number; deps?: ReminderDeps }): Promise<MeetingReply> {
  const { job, scope, nowMs, req } = input
  if (!input.consentOk) return plain('reminder_consent_required', REMINDER_COPY.consent)
  const said = req.messages.map((m) => m.text).join(' ')
  const rows = await listUpcomingReminders(ownerOf(scope), 50)
  if (!rows.length) return plain('reminder_reschedule_none', REMINDER_COPY.none)
  const { time, rest } = targetTime(said)
  const phrase = targetPhrase(rest)
  const found = matchReminders(rows, phrase, time, req.recent)
  if (!found.length) return plain('reminder_reschedule_no_match', noMatch(rows, nowMs))
  if (found.length > 1) return plain('reminder_reschedule_ambiguous', several(found, nowMs, REMINDER_COPY.askWhichMove))
  const r = found[0]

  // The NEW time, anchored on the latest message that said anything about when.
  const today = businessDateString(req.messages[0].ts * 1000)
  const anchor = [...req.messages].reverse().find((m) => mentionsWhen(targetTime(m.text).rest, today)) ?? req.messages[req.messages.length - 1]
  const read = readReminderWhen(rest, { messageTimestampSec: anchor.ts, source: anchor.source }, nowMs)
  if (read.ok === false) {
    if (read.ask === 'unverified_anchor') return plain('reminder_unverified_anchor', REMINDER_COPY.unverified)
    const q = read.ask === 'ask_when' ? REMINDER_COPY.askNewTime : reminderWhenQuestion(read.ask, { hour: read.hour, anchorMs: anchor.ts * 1000 })
    return clarify('reschedule', read.ask, q)
  }
  if (read.remindAtMs === r.remindAtMs) return plain('reminder_reschedule_same_time', `התזכורת כבר קבועה ל${whenLabel(r.remindAtMs, nowMs)}.`)

  const actionId = reminderActionId('reschedule', r.id, r.version, job.id)
  const outcome = await (input.deps?.submit ?? submitProposedAction)({
    proposal: {
      actionType: 'reschedule_reminder',
      args: { reminderId: r.id, version: r.version, remindAt: new Date(read.remindAtMs).toISOString(), requestAnchorMs: anchor.ts * 1000 },
      evidenceRefs: [`reminder:${r.id}`],
    },
    scope,
    agentRunId: `wa_job_${job.id}`,
    identity: { actionId, idempotencyKey: actionId },
  })
  return cardFor({ job, scope, nowMs, op: 'reschedule', actionId, outcome, reused: true, text: rescheduleCard({ text: r.text, fromAtMs: r.remindAtMs, toAtMs: read.remindAtMs, fromMs: nowMs }), ensure: input.deps?.ensure ?? ensureWaApprovalForAction })
}
