import 'server-only'
import { db } from '@/config/db'
import type { WaAssistantJob } from '@/db/waAssistantJobs'

/**
 * ONE request (a meeting, a task, a follow-up), spread over the owner's
 * messages: the current one, then each earlier message that our — or the
 * Agent's — clarifying question answered, within 15 minutes of the next, back
 * to the message that opened it. Newest first.
 *
 * A finished request (a card, a refusal) and unrelated chat end the chain, so
 * "סכם לי את היום" never lends a day to a meeting.
 */

export type RequestKind = 'meeting' | 'task'

const CLARIFY_WINDOW_MS = 15 * 60 * 1000
const REQUEST_MAX_MESSAGES = 6
export const REQUEST_WORDS: Record<RequestKind, RegExp> = {
  meeting: /פגיש|תקבע|לקבוע|קבע/u,
  task: /משימ|מעקב|תזכיר|תזכורת|לחזור|תחזור|לבדוק|תבדוק|להתקשר|תתקשר/u,
}
const FINISHED = /^(meeting|task|follow_up)_/
/** "כן" / "יאללה" answering "…כבר עברה. למחר באותה שעה?" means tomorrow. */
const BARE_YES = /^\s*(כן|כ|בטח|יאללה|אוקיי|אוקי|ok|okay|סבבה|נכון|למחר)[\s.!]*$/iu

export async function requestMessages(kind: RequestKind, job: WaAssistantJob, current: string): Promise<string[]> {
  const [self, ...earlier] = (await db('wa_assistant_jobs')
    .where({ recipientId: job.recipientId })
    .where('id', '<=', job.id)
    .orderBy('id', 'desc')
    .limit(REQUEST_MAX_MESSAGES)
    .select('kind', 'question', 'stopReason', 'createdAt')) as {
    kind: string
    question: string | null
    stopReason: string | null
    createdAt: Date
  }[]
  const out = [current]
  // Measured between arrivals, so a worker picking a message up late cannot break the chain.
  let next = new Date(self.createdAt).getTime()
  for (const [i, r] of earlier.entries()) {
    const at = new Date(r.createdAt).getTime()
    if (r.kind !== 'text' || !r.question || next - at > CLARIFY_WINDOW_MS) break
    const answered = r.stopReason?.startsWith(`${kind}_clarify`) ?? false
    // An opener: a request the Agent answered with its own question — not one of ours, finished or of another kind.
    const opener = !answered && REQUEST_WORDS[kind].test(r.question) && !FINISHED.test(r.stopReason ?? '')
    if (!answered && !opener) break
    if (i === 0 && r.stopReason?.endsWith('_past_today') && BARE_YES.test(current)) out[0] = 'מחר'
    out.push(r.question)
    next = at
    if (opener) break
  }
  return out
}

/** Is this message part of a request of this kind (so the Agent's own question continues it)? */
export async function isRequestConversation(kind: RequestKind, job: WaAssistantJob): Promise<boolean> {
  const q = job.question?.trim() ?? ''
  return REQUEST_WORDS[kind].test(q) || (await requestMessages(kind, job, q)).length > 1
}
