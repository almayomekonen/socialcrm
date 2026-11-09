import 'server-only'
import { submitProposedAction } from '@/lib/agent/actions/bridge'
import type { SystemActionProposal } from '@/lib/agent/actions/systemProposal'
import { createWaApproval } from '@/db/waAssistantApprovals'
import { businessDateString, businessInstantMs, formatBusinessTime } from '@/lib/today/time'
import type { AgentScope, EvidenceRef, ProposedAction } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { findMeetingConflicts, suggestFreeSlots } from '../meetings/conflicts'
import { conflictReply } from '../meetings/copy'
import { googleCalendarConnected } from '../meetings/propose'
import type { MeetingReply } from '../meetings/types'
import { chooseLead } from '../leadChoice'
import { requestMessages } from '../request'
import { whenQuestion } from '../whenCopy'
import { readDraft, withWhen } from '../tasks/draft'
import { CHANGE_COPY, cancelCard, changeButtons, completeTaskCard, rescheduleCard, updateTaskCard, whichMeeting, whichTask, type ChangeType } from './copy'
import { contentWords, pickTarget, titleScore } from './pick'
import { openTasksForLead, upcomingMeetingsForLead, type MeetingTarget, type TaskTarget } from './targets'

/**
 * "תסמן שהמשימה להתקשר לדני בוצעה" / "תזיז את הפגישה עם דני למחר ב-10".
 *
 * The model names a lead and describes the record in the owner's words. It never
 * gives a task or meeting id, so it cannot point at a record outside this
 * agency. In order:
 *   1. the lead (leadChoice.ts), readable by this user;
 *   2. the record, from this lead's own open tasks or upcoming meetings: none is
 *      said plainly, more than one clear candidate is asked about;
 *   3. the new date, read by the system from the owner's own words;
 *   4. the Action Runtime records it AWAITING_APPROVAL with the resolved ids and
 *      a single-use card asks the owner. NOTHING IS CHANGED HERE.
 */

export type ChangeProposal = Extract<ProposedAction, { actionType: ChangeType }>
export type ChangeProposeDeps = { submit?: typeof submitProposedAction }
type Input = {
  job: WaAssistantJob
  scope: AgentScope
  proposal: ChangeProposal
  evidence: readonly EvidenceRef[]
  agentRunId: string
  question: string
  nowMs: number
  deps?: ChangeProposeDeps
}

const TITLE_MAX = 255
const isTaskChange = (p: ChangeProposal) => p.actionType === 'update_task' || p.actionType === 'complete_task'
const said = (text: string) => text.replace(/\s+/gu, ' ').trim()
const answered = (stopReason: string, text: string, headline: string | null = null): MeetingReply => ({ status: 'answered', stopReason, text, headline })

/** The owner's words about the new time: only if they really said them. */
function spokenWhen(p: { args: { newWhen: string | null } }, heard: readonly string[]): string | null {
  const spoken = p.args.newWhen ? said(p.args.newWhen) : ''
  return spoken && said(heard.join(' ')).includes(spoken) ? spoken : null
}

/** The action as runtime arguments, or the question still to ask. */
type Built = { reply: MeetingReply } | { args: Record<string, unknown>; text: (lead: string) => string | Promise<string>; headline: string }

function buildTask(input: Input, heard: readonly string[], task: TaskTarget, ask: (text: string, why: string) => MeetingReply): Built {
  const { proposal: p, nowMs } = input
  const base = { taskId: task.id }
  if (p.actionType === 'complete_task') return { args: base, text: (lead) => completeTaskCard({ lead, task }), headline: 'ממתין לאישור סימון משימה' }
  const up = p as Extract<ChangeProposal, { actionType: 'update_task' }>
  const newTitle = up.args.newTitle?.trim().slice(0, TITLE_MAX) || null
  const spoken = spokenWhen(up, heard)
  if (!newTitle && !spoken) return { reply: ask(CHANGE_COPY.askWhatToChange, 'change_what') }

  let dueDate = task.dueDate
  let title = newTitle ?? task.title
  if (spoken) {
    const d = readDraft([spoken], nowMs)
    const today = businessDateString(nowMs)
    if (d.problem) return { reply: ask(whenQuestion(d.problem, { hour: d.hour, time: d.time }), d.problem) }
    if (d.date && d.date < today) return { reply: ask(whenQuestion('past_date', { hour: null, time: null }), 'past_date') }
    dueDate = d.date ?? task.dueDate ?? today
    // The date column keeps no time of day, so a time lives in the wording, as when a task is created.
    if (d.when) title = withWhen(title.replace(/\s*בשעה \d{1,2}:\d{2}/u, ''), d.when, TITLE_MAX)
  }
  if (title === task.title && dueDate === task.dueDate) return { reply: answered('task_change_nothing', 'המשימה כבר מעודכנת כך, אז לא שיניתי דבר.') }
  return {
    args: { ...base, fromTitle: task.title, fromDueDate: task.dueDate, title, dueDate },
    text: (lead) => updateTaskCard({ lead, task, title, dueDate }),
    headline: 'ממתין לאישור עדכון משימה',
  }
}

async function buildMeeting(input: Input, heard: readonly string[], meeting: MeetingTarget, ask: (text: string, why: string) => MeetingReply): Promise<Built> {
  const { proposal: p, scope, nowMs } = input
  const linked = meeting.hasGoogleEvent && (await googleCalendarConnected(scope.userId))
  const base = { meetingId: meeting.id }
  if (p.actionType === 'cancel_meeting') return { args: base, text: (lead) => cancelCard({ lead, meeting, googleLinked: linked }), headline: 'ממתין לאישור ביטול פגישה' }

  const spoken = spokenWhen(p as Extract<ChangeProposal, { actionType: 'reschedule_meeting' }>, heard)
  if (!spoken) return { reply: ask(CHANGE_COPY.askNewTime, 'change_when') }
  const d = readDraft([spoken], nowMs)
  if (d.problem) return { reply: ask(whenQuestion(d.problem, { hour: d.hour, time: d.time }), d.problem) }
  if (!d.date && !d.time) return { reply: ask(CHANGE_COPY.askNewTime, 'change_when') }

  // "למחר" keeps the hour and "ל-16:00" keeps the day, in the business timezone.
  const date = d.date ?? businessDateString(meeting.startAt.getTime())
  const startTime = d.time ?? formatBusinessTime(meeting.startAt)
  const startMs = businessInstantMs(date, startTime)
  if (!Number.isFinite(startMs) || startMs <= nowMs) return { reply: ask(whenQuestion('past_date', { hour: null, time: d.time }), 'past_date') }
  if (startMs === meeting.startAt.getTime()) return { reply: answered('meeting_change_nothing', CHANGE_COPY.sameTime) }

  const durationMinutes = Math.round((meeting.endAt.getTime() - meeting.startAt.getTime()) / 60_000)
  const start = new Date(startMs)
  const end = new Date(startMs + durationMinutes * 60_000)
  const busy = { agencyId: scope.agencyId, organizerUserId: scope.userId, excludeMeetingId: meeting.id }
  const conflicts = await findMeetingConflicts({ ...busy, startAt: start, endAt: end })
  if (conflicts.length) {
    const free = await suggestFreeSlots({ ...busy, date, afterMs: startMs, durationMinutes, nowMs })
    const text = conflictReply(conflicts[0], free)
    return { reply: answered('meeting_clarify_conflict', text, text) }
  }
  return {
    args: { ...base, fromStartAt: meeting.startAt.toISOString(), date, startTime, durationMinutes },
    text: (lead) => rescheduleCard({ lead, meeting, start, end, googleLinked: linked }),
    headline: 'ממתין לאישור הזזת פגישה',
  }
}

export async function proposeRecordChange(input: Input): Promise<MeetingReply> {
  const { job, scope, proposal, nowMs } = input
  const taskChange = isTaskChange(proposal)
  const kind = taskChange ? 'task' : 'meeting'
  const heard = await requestMessages(kind, job, input.question)
  const answer = heard.length > 1 ? heard[0] : null
  // Carried in the stored headline, so the next message continues this request instead of starting over.
  const ask = (text: string, why: string, lead?: string) => {
    const memo = [taskChange ? 'שינוי משימה' : 'שינוי פגישה', lead ? `ליד: ${lead}` : null, proposal.args.match].filter(Boolean).join(' · ')
    return { status: 'answered' as const, stopReason: `${kind}_clarify_${why}`, text, headline: `${text} (${memo})` }
  }

  const choice = await chooseLead({ scope, proposedId: Number(proposal.args.clientId), evidence: input.evidence, said: heard })
  if ('refused' in choice) return { status: 'refused', stopReason: `${kind}_lead_not_allowed`, text: CHANGE_COPY.leadNotAllowed, headline: null }
  if ('ask' in choice) return ask(choice.ask, 'lead')
  const lead = choice.lead
  const askAbout = (text: string, why: string) => ask(text, why, lead.name)

  let built: Built
  if (taskChange) {
    const picked = pickTarget(await openTasksForLead(scope, lead.id), {
      answer,
      match: proposal.args.match,
      score: (t, text) => titleScore(t.title, contentWords(text)),
    })
    if ('none' in picked) return answered('task_change_no_target', CHANGE_COPY.noTask)
    if ('many' in picked) return askAbout(whichTask(picked.many), 'change_which')
    built = buildTask(input, heard, picked.one, askAbout)
  } else {
    const picked = pickTarget(await upcomingMeetingsForLead(scope, lead.id, nowMs), {
      answer,
      match: proposal.args.match,
      score: (m, text) => meetingScore(m, text, nowMs),
    })
    if ('none' in picked) return answered('meeting_change_no_target', CHANGE_COPY.noMeeting)
    if ('many' in picked) return askAbout(whichMeeting(picked.many), 'change_which')
    built = await buildMeeting(input, heard, picked.one, askAbout)
  }
  if ('reply' in built) return built.reply

  const system: SystemActionProposal = {
    actionType: proposal.actionType,
    args: { ...built.args, clientId: lead.id },
    evidenceRefs: [`lead:${lead.id}`],
  }
  // Submitted without the owner's words, and each of these requires approval: a card, whatever the phrasing.
  const outcome = await (input.deps?.submit ?? submitProposedAction)({ proposal: system, scope, agentRunId: input.agentRunId })
  if (!outcome || outcome.report !== 'AWAITING_APPROVAL') {
    return { status: 'failed', stopReason: `${kind}_change_${outcome?.report ?? 'unparsed'}`, text: CHANGE_COPY.notPrepared, headline: null }
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
  return { status: 'answered', stopReason: `${proposal.actionType}_awaiting_approval`, text: await built.text(lead.name), buttons: changeButtons(token, proposal.actionType), headline: built.headline }
}

/** A meeting named by its day or hour, or by words in its title. */
function meetingScore(m: MeetingTarget, text: string, nowMs: number): number {
  const d = readDraft([text], nowMs)
  const day = d.date && d.date === businessDateString(m.startAt.getTime()) ? 2 : 0
  const hour = d.time && d.time === formatBusinessTime(m.startAt) ? 2 : 0
  return day + hour + titleScore(m.title, contentWords(text))
}
