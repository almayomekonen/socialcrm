import 'server-only'
import { db } from '@/config/db'
import type { WaAssistantJob } from '@/db/waAssistantJobs'
import { answersPending, opensRequest, pointsBack, type RequestKind } from './continuation'

/**
 * ONE request (a meeting, a task, a follow-up, a quote), spread over the owner's
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
  quote: /הצע(?:ת|ה|ות)\s*מחיר|הצעת\s*ה?מחיר/u,
  document: /חשבוני(?:ת|ות)|(?<![\u0590-\u05FF])[הול]?קבל(?:ה|ות)(?![\u0590-\u05FF])/u,
}
/** "כן" / "יאללה" answering "…כבר עברה. למחר באותה שעה?" means tomorrow. */
const BARE_YES = /^\s*(כן|כ|בטח|יאללה|אוקיי|אוקי|ok|okay|סבבה|נכון|למחר)[\s.!]*$/iu

/**
 * A customer who is not a lead yet (quotes only, ./quotes/newCustomer.ts): only
 * what the owner wrote, each field already checked against the owner's words.
 */
export type NewCustomerDraft = { firstName: string | null; lastName: string | null; phone: string | null; email: string | null }

/**
 * What leadChoice.ts stored on a message: the list shown (with `allowNew` when it
 * offered a new lead too), the lead chosen, or a new customer the request is about.
 */
export type StoredLeadChoice = { options?: number[]; allowNew?: boolean; draft?: NewCustomerDraft; leadId?: number; newLead?: NewCustomerDraft }
export type RequestLeadState = { leadId: number | null; newLead: NewCustomerDraft | null; offered: number[] | null; allowNew: boolean; draft: NewCustomerDraft | null; answers: string[] }
type Row = { id: number; kind: string; question: string | null; stopReason: string | null; createdAt: Date; leadChoice: StoredLeadChoice | null }

/**
 * A message we FAILED to handle (the owner was told to try again) is not part of
 * any request: it neither answers the pending question nor replaces it, so the
 * owner resending "1" still answers the list they were shown.
 */
const recentRows = (job: WaAssistantJob) =>
  db('wa_assistant_jobs')
    .where({ recipientId: job.recipientId })
    .where('id', '<=', job.id)
    .where((q) => q.whereNot('status', 'failed').orWhere('id', job.id))
    .orderBy('id', 'desc')
    .limit(REQUEST_MAX_MESSAGES)
    .select('id', 'kind', 'question', 'stopReason', 'createdAt', 'leadChoice') as Promise<Row[]>

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
): { said: string[]; turns: RequestTurn[]; pending: boolean; members: Row[] } {
  const waiting: Row[] = []
  let next = new Date(self.createdAt).getTime()
  for (const r of earlier) {
    const at = new Date(r.createdAt).getTime()
    if (r.kind !== 'text' || !r.question || next - at > windowMs || !r.stopReason?.startsWith(`${kind}_clarify_`)) break
    waiting.push(r)
    next = at
  }
  if (!waiting.length) return { said: [current], turns: [{ text: current, answering: null }], pending: false, members: [] }

  const [first, ...rest] = [...waiting].reverse()
  let said = [first.question!]
  // The same messages, each with the question it answered (null: it opened the request).
  let turns: RequestTurn[] = [{ text: first.question!, answering: null }]
  // The earlier messages of this request, oldest first (the current one is not a row yet).
  let members: Row[] = [first]
  let asked = first.stopReason!
  for (const m of [...rest.map((r) => ({ text: r.question!, stopReason: r.stopReason!, row: r as Row | null })), { text: current, stopReason: '', row: null }]) {
    const answer = asked.endsWith('_past_today') && BARE_YES.test(m.text) ? 'מחר' : m.text
    const continues = answersPending({ kind, pendingStopReason: asked, text: m.text, request: said })
    said = continues ? [...said, answer] : [m.text]
    turns = continues ? [...turns, { text: answer, answering: asked }] : [{ text: m.text, answering: null }]
    members = continues ? (m.row ? [...members, m.row] : members) : m.row ? [m.row] : []
    asked = m.stopReason
  }
  return { said: said.reverse(), turns: turns.reverse(), pending: true, members }
}

export async function requestMessages(kind: RequestKind, job: WaAssistantJob, current: string): Promise<string[]> {
  return replay(kind, await recentRows(job), current, CLARIFY_WINDOW_MS).said
}

/**
 * One message of a request and the question it answered: the stopReason of the
 * message before it ("document_clarify_payment"), or null for the message that
 * opened the request. Lets a reader take a bare "3" as the installments it
 * answers, never as an amount, and accept a typo only inside the question asked.
 */
export type RequestTurn = { text: string; answering: string | null }

/** `requestMessages`, with each message's question. Newest first. */
export async function requestTurns(kind: RequestKind, job: WaAssistantJob, current: string): Promise<RequestTurn[]> {
  return replay(kind, await recentRows(job), current, CLARIFY_WINDOW_MS).turns
}

/**
 * The lead choice already made in THIS request: the lead the owner chose, or the
 * list we showed them and the message that answered it (the newest such answer).
 * Only messages of the same request count, so an abandoned request lends nothing.
 */
export async function requestLeadState(kind: RequestKind, job: WaAssistantJob, current: string): Promise<RequestLeadState> {
  const rows = await recentRows(job)
  const { members } = replay(kind, rows, current, CLARIFY_WINDOW_MS)
  const earlier = members.filter((r) => r.id !== job.id)
  const last = (test: (r: Row) => boolean) => {
    for (let i = earlier.length - 1; i >= 0; i--) if (test(earlier[i])) return i
    return -1
  }
  const pinnedAt = last((r) => Number.isSafeInteger(r.leadChoice?.leadId) || !!r.leadChoice?.newLead)
  const offeredAt = last((r) => Array.isArray(r.leadChoice?.options) && r.leadChoice!.options!.length > 0)
  const none: RequestLeadState = { leadId: null, newLead: null, offered: null, allowNew: false, draft: null, answers: [] }
  // A pick made after the newest list stands; a list shown after a pick replaces it.
  if (pinnedAt > offeredAt) {
    const pinned = earlier[pinnedAt].leadChoice!
    return Number.isSafeInteger(pinned.leadId) ? { ...none, leadId: pinned.leadId! } : { ...none, newLead: pinned.newLead! }
  }
  if (offeredAt < 0) return none
  // Every reply since the list, newest first: the current message, then the earlier ones.
  const replies = [current, ...earlier.slice(offeredAt + 1).map((r) => r.question ?? '').reverse()].filter((t) => t.trim())
  const shown = earlier[offeredAt].leadChoice!
  return { ...none, offered: shown.options!, allowNew: shown.allowNew === true, draft: shown.draft ?? null, answers: replies }
}

/** The list shown, the lead chosen, or the new customer. Written on the message being handled. */
export async function recordLeadChoice(jobId: number, choice: StoredLeadChoice): Promise<void> {
  await db('wa_assistant_jobs').where({ id: jobId }).update({ leadChoice: JSON.stringify(choice) })
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
/** The kind of request whose question is pending right now (the previous message asked it), or null. */
export async function pendingRequestKind(job: WaAssistantJob): Promise<RequestKind | null> {
  const rows = await recentRows(job)
  const asked = rows[1]?.stopReason ?? ''
  return (['quote', 'meeting', 'task', 'status', 'note', 'document'] as const).find((k) => asked.startsWith(`${k}_clarify_`)) ?? null
}

export async function startsCleanRequest(job: WaAssistantJob): Promise<boolean> {
  const q = job.question?.trim() ?? ''
  if (pointsBack(q)) return false
  const rows = await recentRows(job)
  const pendingKind = (['meeting', 'status', 'note', 'quote', 'document'] as const).find((k) => rows[1]?.stopReason?.startsWith(`${k}_clarify_`))
  const kind: RequestKind = pendingKind ?? 'task'
  const { said, pending } = replay(kind, rows, q, Number.POSITIVE_INFINITY)
  return pending ? said.length === 1 : opensRequest(q)
}
