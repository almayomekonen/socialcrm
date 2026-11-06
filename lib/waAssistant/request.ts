import 'server-only'
import { db } from '@/config/db'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { answersPending, opensRequest, pointsBack, type RequestKind } from './continuation'

/**
 * ONE request (a meeting, a task, a follow-up), spread over the owner's
 * messages. Context carries ONLY while the owner is answering a pending question
 * (continuation.ts judges that against the question actually asked): a message
 * with new content starts clean, and the abandoned request lends it no lead,
 * day, time or action. So do unrelated chat and a finished request.
 */

export type { RequestKind } from './continuation'

const CLARIFY_WINDOW_MS = 15 * 60 * 1000
const REQUEST_MAX_MESSAGES = 6
export const REQUEST_WORDS: Record<RequestKind, RegExp> = {
  meeting: /פגיש|תקבע|לקבוע|קבע/u,
  task: /משימ|מעקב|תזכיר|תזכורת|לחזור|תחזור|לבדוק|תבדוק|להתקשר|תתקשר/u,
  status: /סטטוס|תעביר|להעביר|תסמן|לסמן/u,
  note: /הערה|הערות|תרשום|לרשום|רשום/u,
}
/** "כן" / "יאללה" answering "…כבר עברה. למחר באותה שעה?" means tomorrow. */
const BARE_YES = /^\s*(כן|כ|בטח|יאללה|אוקיי|אוקי|ok|okay|סבבה|נכון|למחר)[\s.!]*$/iu

type Row = { kind: string; question: string | null; stopReason: string | null; createdAt: Date }

const recentRows = (job: WaAssistantJob) =>
  db('wa_assistant_jobs')
    .where({ recipientId: job.recipientId })
    .where('id', '<=', job.id)
    .orderBy('id', 'desc')
    .limit(REQUEST_MAX_MESSAGES)
    .select('kind', 'question', 'stopReason', 'createdAt') as Promise<Row[]>

/**
 * Replays the owner's messages oldest first, each judged against the question
 * that was pending when it arrived, so a request abandoned two questions ago
 * cannot leak through the one in between. Returns the request's messages, newest
 * first, and whether a question was pending at all.
 */
function replay(
  kind: RequestKind,
  [self, ...earlier]: Row[],
  current: string,
  windowMs: number,
): { said: string[]; pending: boolean } {
  const waiting: Row[] = []
  let next = new Date(self.createdAt).getTime()
  for (const r of earlier) {
    const at = new Date(r.createdAt).getTime()
    if (r.kind !== 'text' || !r.question || next - at > windowMs || !r.stopReason?.startsWith(`${kind}_clarify_`)) break
    waiting.push(r)
    next = at
  }
  if (!waiting.length) return { said: [current], pending: false }

  const [first, ...rest] = [...waiting].reverse()
  let said = [first.question!]
  let asked = first.stopReason!
  for (const m of [...rest.map((r) => ({ text: r.question!, stopReason: r.stopReason! })), { text: current, stopReason: '' }]) {
    const answer = asked.endsWith('_past_today') && BARE_YES.test(m.text) ? 'מחר' : m.text
    said = answersPending({ kind, pendingStopReason: asked, text: m.text, request: said }) ? [...said, answer] : [m.text]
    asked = m.stopReason
  }
  return { said: said.reverse(), pending: true }
}

export async function requestMessages(kind: RequestKind, job: WaAssistantJob, current: string): Promise<string[]> {
  return replay(kind, await recentRows(job), current, CLARIFY_WINDOW_MS).said
}

/** Is this message part of a request of this kind (so the Agent's own question continues it)? */
export async function isRequestConversation(kind: RequestKind, job: WaAssistantJob): Promise<boolean> {
  const q = job.question?.trim() ?? ''
  return REQUEST_WORDS[kind].test(q) || (await requestMessages(kind, job, q)).length > 1
}

/**
 * A new request, so the Agent must not read earlier requests' questions as its
 * context (their stored headlines carry a lead, day and time). A pending question
 * counts here at any age, and the owner pointing back keeps the turns.
 */
export async function startsCleanRequest(job: WaAssistantJob): Promise<boolean> {
  const q = job.question?.trim() ?? ''
  if (pointsBack(q)) return false
  const rows = await recentRows(job)
  const pendingKind = (['meeting', 'status', 'note'] as const).find((k) => rows[1]?.stopReason?.startsWith(`${k}_clarify_`))
  const kind: RequestKind = pendingKind ?? 'task'
  const { said, pending } = replay(kind, rows, q, Number.POSITIVE_INFINITY)
  return pending ? said.length === 1 : opensRequest(q)
}
