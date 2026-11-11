import 'server-only'
import { submitProposedAction } from '@/lib/agent/actions/bridge'
import { createWaApproval } from '@/db/waAssistantApprovals'
import type { AgentScope, EvidenceRef, ProposedAction } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { hebrewDateLabel } from '../meetings/when'
import type { MeetingReply } from '../meetings/types'
import { requestMessages } from '../request'
import { chooseLead } from '../leadChoice'
import { whenQuestion } from '../whenCopy'
import { TASK_COPY, followUpCard, taskButtons, taskCard } from './copy'
import { readDraft, settleWhen, withWhen, type TaskKind } from './draft'

/**
 * "תזכיר לי לחזור לדני מחר" / "תיצור משימה להתקשר לדני" → a confirmation card
 * at once whenever the request is complete, otherwise ONE short question about
 * the one detail that is genuinely missing or ambiguous.
 *
 * A request may arrive over several messages, so everything below reads the
 * whole request (request.ts), not this message alone; a detail the owner gave
 * is never asked for again.
 *
 * NOTHING IS CREATED HERE. In order:
 *   1. the lead (leadChoice.ts): readable by THIS user (agency + rep
 *      visibility), the same bound the executors enforce; several matching
 *      leads → the owner chooses, never us;
 *   2. the day and time come from the owner's own words, never the Agent's
 *      arithmetic; no day named → today (business timezone); a time today that
 *      already passed → ask, never move it silently;
 *   3. the existing Action Runtime records the action as AWAITING_APPROVAL —
 *      submitted WITHOUT the owner's words, so the runtime itself requires an
 *      approval, whatever the phrasing;
 *   4. a single-use, recipient-bound, 15-minute token binds the card's buttons
 *      to that action + argsHash (the same store the meeting card uses).
 */

const TITLE_MAX = 255
const NOTE_MAX = 500

export type TaskProposal = Extract<ProposedAction, { actionType: 'create_task' | 'create_follow_up' }>
export type TaskProposeDeps = { submit?: typeof submitProposedAction }

/**
 * The owner sees `text`; `memo` is what the Agent reads back as this turn on
 * the next message (the stored headline), so it carries what is already
 * settled — kind, lead, day, time — and the next turn continues instead of
 * starting over.
 */
const clarify = (text: string, why: string, memo: string[] = []): MeetingReply => ({
  status: 'answered',
  stopReason: `task_clarify_${why}`,
  text,
  headline: memo.length ? `${text} (${memo.join(' · ')})` : text,
})

/** The action as the owner asked for it: their kind, their day, their time in the wording. Null: a task with nothing to say. */
function finalProposal(
  p: TaskProposal,
  kind: TaskKind,
  clientId: number,
  date: string,
  when: string | null,
): TaskProposal | null {
  const said = p.actionType === 'create_task' ? p.args.title : p.args.note
  const evidenceRefs = p.evidenceRefs.includes(`lead:${clientId}`) ? p.evidenceRefs : [...p.evidenceRefs, `lead:${clientId}`]
  if (kind === 'task') {
    if (!said?.trim()) return null
    return { actionType: 'create_task', args: { clientId, title: withWhen(said, when, TITLE_MAX), dueDate: date }, evidenceRefs }
  }
  return {
    actionType: 'create_follow_up',
    args: { clientId, at: date, note: withWhen(said, when, NOTE_MAX) || null },
    evidenceRefs,
  }
}

export async function proposeTaskOrFollowUp(input: {
  job: WaAssistantJob
  scope: AgentScope
  proposal: TaskProposal
  evidence: readonly EvidenceRef[]
  agentRunId: string
  question: string
  nowMs: number
  deps?: TaskProposeDeps
}): Promise<MeetingReply> {
  const { job, scope, nowMs } = input
  const said = await requestMessages('task', job, input.question)
  const draft = readDraft(said, nowMs)
  const kind: TaskKind = draft.kind ?? (input.proposal.actionType === 'create_task' ? 'task' : 'follow_up')
  const memo = (leadName?: string) =>
    [
      kind === 'task' ? 'משימה' : 'מעקב',
      leadName ? `ליד: ${leadName}` : null,
      draft.date ? hebrewDateLabel(draft.date) : null,
      draft.when,
    ].filter((x): x is string => !!x)
  // 1. Which lead: one already chosen in this request wins over the Agent's clientId.
  const choice = await chooseLead({ scope, proposedId: Number(input.proposal.args.clientId), evidence: input.evidence, said, request: { job, kind: 'task' }, requireProposed: true })
  if ('missing' in choice) return clarify(TASK_COPY.askLead, 'lead', memo())
  if ('refused' in choice)
    return { status: 'refused', stopReason: 'task_lead_not_allowed', text: TASK_COPY.leadNotAllowed, headline: null }
  if ('ask' in choice) return clarify(choice.ask, 'lead', memo())
  const lead = choice.lead

  // 2. Which day (and time), from the owner's own words; no day named → today.
  const ask = (text: string, why: string) => clarify(text, why, memo(lead.name))
  const when = settleWhen(draft, nowMs, { timeRequired: false })
  if (when.ok === false) return ask(whenQuestion(when.ask, when), when.ask)
  const proposal = finalProposal(input.proposal, kind, lead.id, when.date, draft.when)
  if (!proposal) return ask(TASK_COPY.askTitle, 'title')
  const day = when.date

  // 3. Recorded, awaiting approval. 4. A single-use card.
  const outcome = await (input.deps?.submit ?? submitProposedAction)({ proposal, scope, agentRunId: input.agentRunId })
  if (!outcome || outcome.report !== 'AWAITING_APPROVAL') {
    return {
      status: 'failed',
      stopReason: `task_propose_${outcome?.report ?? 'unparsed'}`,
      text: TASK_COPY.notPrepared,
      headline: null,
    }
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
  const text =
    proposal.actionType === 'create_task'
      ? taskCard({ lead: lead.name, title: proposal.args.title, dueDate: day, when: draft.when })
      : followUpCard({ lead: lead.name, at: day, note: proposal.args.note?.trim() || null, when: draft.when })
  return {
    status: 'answered',
    stopReason: `${kind}_awaiting_approval`,
    text,
    buttons: taskButtons(token, kind),
    headline: kind === 'task' ? 'ממתין לאישור יצירת משימה' : 'ממתין לאישור קביעת מעקב',
  }
}
