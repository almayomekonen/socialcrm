import 'server-only'
import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import { submitProposedAction } from '@/lib/agent/actions/bridge'
import { businessDateString } from '@/lib/today/time'
import { createWaApproval } from '@/db/waAssistantApprovals'
import type { AgentScope, EvidenceRef, ProposedAction } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { hebrewDateLabel } from '../meetings/when'
import type { MeetingReply } from '../meetings/types'
import { TASK_COPY, ambiguousTimeReply, followUpCard, taskButtons, taskCard, whichLeadReply } from './copy'
import { namedLead, readDraft, withWhen, type TaskDraft, type TaskKind } from './draft'

/**
 * "תזכיר לי לחזור לדני מחר" / "תפתח משימת מעקב לליד הזה" → a confirmation
 * card, or ONE short question about the one detail still missing.
 *
 * A request may arrive over several messages, so everything below reads the
 * whole request — this message and the owner's earlier messages that it
 * continues (draft.ts) — not this message alone. A detail the owner gave is
 * never asked for again; a time given before the day is kept.
 *
 * NOTHING IS CREATED HERE. In order:
 *   1. the lead: the proposed lead must be readable by THIS user (agency + rep
 *      visibility), the same bound the executors enforce; when the Agent's reads
 *      produced SEVERAL readable leads, the one whose full name the owner wrote
 *      is taken, otherwise we ask which (never pick);
 *   2. the day (and time) come from the owner's own words, never the Agent's
 *      arithmetic; missing or unclear → ask;
 *   3. the existing Action Runtime records the action as AWAITING_APPROVAL —
 *      submitted WITHOUT the owner's words, so the runtime itself requires an
 *      approval, whatever the phrasing;
 *   4. a single-use, recipient-bound, 15-minute token binds the card's buttons
 *      to that action + argsHash (the same store the meeting card uses).
 */

const CLARIFY_WINDOW_MS = 15 * 60 * 1000
const REQUEST_MAX_MESSAGES = 6
const TASK_WORDS = /משימ|מעקב|תזכיר|תזכורת|לחזור|תחזור|לבדוק|תבדוק|להתקשר|תתקשר/u
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

/**
 * The owner's messages that make up THIS request, newest first: the current
 * one, then each earlier message our (or the Agent's) clarifying question
 * answered, within 15 minutes of the next, back to the message that opened it.
 */
async function requestMessages(job: WaAssistantJob, current: string, nowMs: number): Promise<string[]> {
  const rows = (await db('wa_assistant_jobs')
    .where({ recipientId: job.recipientId })
    .where('id', '<', job.id)
    .orderBy('id', 'desc')
    .limit(REQUEST_MAX_MESSAGES - 1)
    .select('kind', 'question', 'stopReason', 'createdAt')) as {
    kind: string
    question: string | null
    stopReason: string | null
    createdAt: Date
  }[]
  const out = [current]
  let next = nowMs
  for (const r of rows) {
    const at = new Date(r.createdAt).getTime()
    if (r.kind !== 'text' || !r.question || next - at > CLARIFY_WINDOW_MS) break
    const answered = r.stopReason?.startsWith('task_clarify') ?? false
    // An opener: a task request the Agent answered with its own question — not a finished card.
    const opener = !answered && TASK_WORDS.test(r.question) && !/^(task|follow_up)_/.test(r.stopReason ?? '')
    if (!answered && !opener) break
    out.push(r.question)
    next = at
    if (opener) break
  }
  return out
}

/** Is this message part of a task / follow-up conversation (so the Agent's own question continues it)? */
export async function isTaskConversation(job: WaAssistantJob, nowMs: number): Promise<boolean> {
  const q = job.question?.trim() ?? ''
  return TASK_WORDS.test(q) || (await requestMessages(job, q, nowMs)).length > 1
}

/** Leads this user may act on, by id, with display names (agency + rep visibility). */
async function readableLeads(scope: AgentScope, ids: number[]): Promise<{ id: number; name: string }[]> {
  if (!ids.length) return []
  const q = db('clients').where({ agencyId: scope.agencyId }).whereIn('id', ids)
  if (!isAdmin(scope.role)) q.whereIn('userId', scope.gotPermIds ?? [])
  const rows = (await q.select('id', 'firstName', 'lastName')) as {
    id: number
    firstName: string | null
    lastName: string | null
  }[]
  return rows.map((r) => ({ id: Number(r.id), name: [r.firstName, r.lastName].filter(Boolean).join(' ') }))
}

/** The action as the owner asked for it: their kind, their day, their time in the wording. Null: a task with nothing to say. */
function finalProposal(
  p: TaskProposal,
  kind: TaskKind,
  clientId: number,
  draft: TaskDraft & { date: string },
): TaskProposal | null {
  const said = p.actionType === 'create_task' ? p.args.title : p.args.note
  const evidenceRefs = p.evidenceRefs.includes(`lead:${clientId}`) ? p.evidenceRefs : [...p.evidenceRefs, `lead:${clientId}`]
  if (kind === 'task') {
    if (!said?.trim()) return null
    return {
      actionType: 'create_task',
      args: { clientId, title: withWhen(said, draft.when, TITLE_MAX), dueDate: draft.date },
      evidenceRefs,
    }
  }
  return {
    actionType: 'create_follow_up',
    args: { clientId, at: draft.date, note: withWhen(said, draft.when, NOTE_MAX) || null },
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
  const said = await requestMessages(job, input.question, nowMs)
  const draft = readDraft(said, nowMs)
  const kind: TaskKind = draft.kind ?? (input.proposal.actionType === 'create_task' ? 'task' : 'follow_up')
  const memo = (leadName?: string) =>
    [
      kind === 'task' ? 'משימה' : 'מעקב',
      leadName ? `ליד: ${leadName}` : null,
      draft.date ? hebrewDateLabel(draft.date) : null,
      draft.when,
    ].filter((x): x is string => !!x)
  const clientId = Number(input.proposal.args.clientId)
  if (!Number.isSafeInteger(clientId) || clientId <= 0) return clarify(TASK_COPY.askLead, 'lead', memo())

  // 1. Which lead. Several readable leads among what the Agent read → the one the owner named, or ask.
  const seen = [...new Set(input.evidence.filter((e) => e.kind === 'lead').map((e) => Number(e.refId)))].filter(
    (n) => Number.isSafeInteger(n) && n > 0,
  )
  const candidates = await readableLeads(scope, [...new Set([...seen, clientId])])
  const lead = candidates.length > 1 ? namedLead(candidates, said) : candidates.find((c) => c.id === clientId)
  if (!lead && candidates.length > 1) return clarify(whichLeadReply(candidates.map((c) => c.name)), 'lead', memo())
  if (!lead) return { status: 'refused', stopReason: 'task_lead_not_allowed', text: TASK_COPY.leadNotAllowed, headline: null }

  // 2. Which day (and time), from the owner's own words.
  const ask = (text: string, why: string) => clarify(text, why, memo(lead.name))
  if (draft.problem === 'ambiguous_date') return ask(TASK_COPY.ambiguousDate, 'date')
  if (draft.problem === 'past_date') return ask(TASK_COPY.pastDate, 'past')
  if (!draft.date) return ask(TASK_COPY.askDate, 'date')
  if (draft.date < businessDateString(nowMs)) return ask(TASK_COPY.pastDate, 'past')
  if (draft.problem === 'ambiguous_time') return ask(ambiguousTimeReply(draft.hour), 'time')
  const proposal = finalProposal(input.proposal, kind, lead.id, { ...draft, date: draft.date })
  if (!proposal) return ask(TASK_COPY.askTitle, 'title')
  const day = draft.date

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
