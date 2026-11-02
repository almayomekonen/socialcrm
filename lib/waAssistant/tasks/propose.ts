import 'server-only'
import { db } from '@/config/db'
import { isAdmin } from '@/types/roles'
import { submitProposedAction } from '@/lib/agent/actions/bridge'
import { businessDateString } from '@/lib/today/time'
import { createWaApproval } from '@/db/waAssistantApprovals'
import type { AgentScope, EvidenceRef, ProposedAction } from '@/lib/agent/types'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { resolveWhen } from '../meetings/when'
import type { MeetingReply } from '../meetings/types'
import { TASK_COPY, followUpCard, taskButtons, taskCard, whichLeadReply } from './copy'

/**
 * "תזכיר לי לחזור לדני מחר" / "תפתח משימת מעקב לליד הזה" → a confirmation
 * card, or a question.
 *
 * NOTHING IS CREATED HERE. In order:
 *   1. the lead: when the Agent's reads produced SEVERAL readable leads, ask
 *      which one (never pick); the proposed lead must be readable by THIS user
 *      (agency + rep visibility), the same bound the executors enforce;
 *   2. the day is read deterministically from the owner's own words and must
 *      equal the Agent's argument; otherwise we ask (never guess);
 *   3. the existing Action Runtime records the action as AWAITING_APPROVAL —
 *      submitted WITHOUT the owner's words, so the runtime itself requires an
 *      approval, whatever the phrasing;
 *   4. a single-use, recipient-bound, 15-minute token binds the card's buttons
 *      to that action + argsHash (the same store the meeting card uses).
 */

const CLARIFY_WINDOW_MS = 15 * 60 * 1000
const TASK_WORDS = /משימ|מעקב|תזכיר|תזכורת|לחזור|תחזור|לבדוק|תבדוק/u

export type TaskProposal = Extract<ProposedAction, { actionType: 'create_task' | 'create_follow_up' }>
export type TaskProposeDeps = { submit?: typeof submitProposedAction }

const clarify = (text: string, why: string): MeetingReply => ({
  status: 'answered',
  stopReason: `task_clarify_${why}`,
  text,
  headline: text,
})

/** The owner's previous message, when this one completes the same request (our own question answered, within 15 minutes). */
async function clarifiedQuestion(job: WaAssistantJob, nowMs: number): Promise<string[]> {
  const prev = (await db('wa_assistant_jobs')
    .where({ recipientId: job.recipientId, kind: 'text' })
    .where('id', '<', job.id)
    .orderBy('id', 'desc')
    .first('question', 'stopReason', 'createdAt')) as
    | { question: string | null; stopReason: string | null; createdAt: Date }
    | undefined
  if (!prev?.question || nowMs - new Date(prev.createdAt).getTime() > CLARIFY_WINDOW_MS) return []
  return prev.stopReason?.startsWith('task_clarify') || TASK_WORDS.test(prev.question) ? [prev.question] : []
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
  const { job, scope, proposal, nowMs } = input
  const kind = proposal.actionType === 'create_task' ? 'task' : 'follow_up'
  const clientId = Number(proposal.args.clientId)
  if (!Number.isSafeInteger(clientId) || clientId <= 0) return clarify(TASK_COPY.askLead, 'lead')

  // 1. Which lead. Several readable leads among what the Agent read → ask.
  const seen = [...new Set(input.evidence.filter((e) => e.kind === 'lead').map((e) => Number(e.refId)))].filter(
    (n) => Number.isSafeInteger(n) && n > 0,
  )
  const candidates = await readableLeads(scope, [...new Set([...seen, clientId])])
  if (candidates.length > 1) return clarify(whichLeadReply(candidates.map((c) => c.name)), 'lead')
  const lead = candidates.find((c) => c.id === clientId)
  if (!lead) return { status: 'refused', stopReason: 'task_lead_not_allowed', text: TASK_COPY.leadNotAllowed, headline: null }

  // 2. Which day, from the owner's own words.
  const when = resolveWhen(input.question, await clarifiedQuestion(job, nowMs), nowMs)
  if (when.problem === 'ambiguous_date') return clarify(TASK_COPY.ambiguousDate, 'date')
  if (when.problem === 'past_date') return clarify(TASK_COPY.pastDate, 'past')
  if (!when.date) return clarify(TASK_COPY.askDate, 'date')
  const day = proposal.actionType === 'create_task' ? proposal.args.dueDate : proposal.args.at
  if (when.date !== day) return clarify(TASK_COPY.mismatch, 'mismatch')
  if (day < businessDateString(nowMs)) return clarify(TASK_COPY.pastDate, 'past')

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
      ? taskCard({ lead: lead.name, title: proposal.args.title, dueDate: day })
      : followUpCard({ lead: lead.name, at: day, note: proposal.args.note?.trim() || null })
  return {
    status: 'answered',
    stopReason: `${kind}_awaiting_approval`,
    text,
    buttons: taskButtons(token, kind),
    headline: kind === 'task' ? 'ממתין לאישור יצירת משימה' : 'ממתין לאישור קביעת מעקב',
  }
}
