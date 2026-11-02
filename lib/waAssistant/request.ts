import 'server-only'
import { db } from '@/config/db'
import type { WaAssistantJob } from '@/db/waAssistantJobs'

/**
 * ONE request (a meeting, a task, a follow-up), spread over the owner's
 * messages: the current one, then each earlier message that our — or the
 * Agent's — clarifying question answered, within 15 minutes of the next, back
 * to the message that opened it. Newest first.
 *
 * Context carries ONLY while the owner is answering a pending question. A
 * message that opens a new request ("תיצור משימה לרון" while a meeting with אבי
 * still waits for a time) starts clean: the abandoned request lends it no lead,
 * day, time or action. So do unrelated chat and a finished request.
 */

export type RequestKind = 'meeting' | 'task'

const CLARIFY_WINDOW_MS = 15 * 60 * 1000
const REQUEST_MAX_MESSAGES = 6
export const REQUEST_WORDS: Record<RequestKind, RegExp> = {
  meeting: /פגיש|תקבע|לקבוע|קבע/u,
  task: /משימ|מעקב|תזכיר|תזכורת|לחזור|תחזור|לבדוק|תבדוק|להתקשר|תתקשר/u,
}
/**
 * Names an action, or commands one. "תקבע" alone is not here: "תקבע ב-11" answers
 * "באיזו שעה?". A bare "משימה" answers "משימה או מעקב?", so it does not open one.
 */
const OPENS_REQUEST =
  /(?:^|[^\p{L}])(?:[ולה]?(?:משימ\p{L}*|פגיש\p{L}*|מעקב|תזכורת)|תיצור|ליצור|צור|תפתח|לפתוח|פתח|תזכיר|תרשום|תוסיף)(?![\p{L}])/u
const BARE_ACTION = /^\s*[ולה]?(?:משימה|פגישה|מעקב|תזכורת)[\s.!]*$/u
/** "לליד הזה", "אותו ליד", "תפתח לו": the owner points back, so the Agent keeps the earlier turns. */
const POINTS_BACK = /(?:^|[^\p{L}])(?:אותו|אותה|הזה|הזאת|הזו|אליו|אליה|איתו|איתה|לו|לה)(?![\p{L}])/u

export const opensRequest = (text: string): boolean => OPENS_REQUEST.test(text) && !BARE_ACTION.test(text)

/** A new request that does not point back: the Agent must not read an earlier request's questions as its context. */
export const startsClean = (text: string): boolean => opensRequest(text) && !POINTS_BACK.test(text)

/** "כן" / "יאללה" answering "…כבר עברה. למחר באותה שעה?" means tomorrow. */
const BARE_YES = /^\s*(כן|כ|בטח|יאללה|אוקיי|אוקי|ok|okay|סבבה|נכון|למחר)[\s.!]*$/iu

export async function requestMessages(kind: RequestKind, job: WaAssistantJob, current: string): Promise<string[]> {
  if (opensRequest(current)) return [current]
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
    // Only a question of ours, of this kind, still waiting for this answer.
    if (!r.stopReason?.startsWith(`${kind}_clarify`)) break
    if (i === 0 && r.stopReason.endsWith('_past_today') && BARE_YES.test(current)) out[0] = 'מחר'
    out.push(r.question)
    next = at
    if (opensRequest(r.question)) break
  }
  return out
}

/** Is this message part of a request of this kind (so the Agent's own question continues it)? */
export async function isRequestConversation(kind: RequestKind, job: WaAssistantJob): Promise<boolean> {
  const q = job.question?.trim() ?? ''
  return REQUEST_WORDS[kind].test(q) || (await requestMessages(kind, job, q)).length > 1
}
