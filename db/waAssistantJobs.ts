import type { Knex } from 'knex'
import { db } from '@/config/db'
import { WA_ASSISTANT_LIMITS } from '@/lib/flags/waAssistantFlags'

/**
 * wa_assistant_jobs: queue, memory, ledger and reply state for the WhatsApp
 * assistant. Every transition is a guarded statement on the current status.
 */

const T = 'wa_assistant_jobs'

export type WaAssistantJob = {
  id: number
  wamid: string
  recipientId: number
  agencyId: number
  userId: number
  kind: 'text' | 'unsupported' | 'decision'
  question: string | null
  messageTimestamp: number
  /** Provenance of `messageTimestamp`; only 'meta' is verified. Absent/NULL = unknown. */
  timestampSource?: 'meta' | 'server' | null
  attempts: number
}

/** Inside the platform-inbound transaction. False for a redelivery (no second job). */
export async function enqueueWaAssistantJob(
  trx: Knex.Transaction,
  row: {
    wamid: string
    recipientId: number
    agencyId: number
    userId: number
    kind: 'text' | 'unsupported' | 'decision'
    question: string | null
    messageTimestamp: number
    timestampSource?: 'meta' | 'server' | null
  },
): Promise<boolean> {
  const inserted = await trx(T).insert(row).onConflict('wamid').ignore().returning('id')
  return inserted.length > 0
}

/** A `running` job past its lease was interrupted. Failed, never re-run; a reply mid-send becomes `unknown`. */
export async function reapStaleWaAssistantJobs(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - WA_ASSISTANT_LIMITS.leaseMs)
  const rows = await db(T)
    .where({ status: 'running' })
    .where('lockedAt', '<', cutoff)
    .update({
      status: 'failed',
      stopReason: 'lease_expired',
      replyState: db.raw(`CASE WHEN "replyState" = 'sending' THEN 'unknown' ELSE "replyState" END`),
      lockedAt: null,
      updatedAt: db.fn.now(),
    })
    .returning('id')
  return rows.length
}

/**
 * Claim up to `limit` queued jobs, at most ONE per recipient and never for a
 * recipient that already has a running job: a sender's messages are answered
 * one at a time, in order.
 */
export async function claimWaAssistantJobs(limit: number): Promise<WaAssistantJob[]> {
  const { rows } = await db.raw(
    `UPDATE ${T} j
        SET status = 'running', attempts = j.attempts + 1, "lockedAt" = now(), "updatedAt" = now()
      WHERE j.id IN (
        SELECT q.id
          FROM ${T} q
         WHERE q.status = 'queued'
           AND NOT EXISTS (SELECT 1 FROM ${T} r WHERE r."recipientId" = q."recipientId" AND r.status = 'running')
           -- Only the recipient's OLDEST queued message. A concurrent claimer
           -- still sees that older row as queued, so it can never take a newer one.
           AND NOT EXISTS (
             SELECT 1 FROM ${T} o
              WHERE o."recipientId" = q."recipientId" AND o.status = 'queued'
                AND (o."createdAt", o.id) < (q."createdAt", q.id)
           )
         ORDER BY q."createdAt", q.id
         LIMIT :limit
         FOR UPDATE SKIP LOCKED
      )
      RETURNING j.id, j.wamid, j."recipientId", j."agencyId", j."userId", j.kind, j.question, j."messageTimestamp", j."timestampSource", j.attempts`,
    { limit },
  )
  return rows.map((r: Record<string, unknown>) => ({
    id: Number(r.id),
    wamid: String(r.wamid),
    recipientId: Number(r.recipientId),
    agencyId: Number(r.agencyId),
    userId: Number(r.userId),
    kind: r.kind as WaAssistantJob['kind'],
    question: (r.question as string | null) ?? null,
    messageTimestamp: Number(r.messageTimestamp),
    timestampSource: (r.timestampSource as 'meta' | 'server' | null) ?? null,
    attempts: Number(r.attempts),
  }))
}

/**
 * Prior exchanges for this recipient, oldest first, inside the memory window.
 * `withoutClarifications`: leave out turns that were a request's open questions
 * (their stored headlines carry its lead, day and time), for a message that
 * starts a new request.
 */
export async function recentWaAssistantTurns(
  recipientId: number,
  beforeJobId: number,
  now: Date,
  opts: { withoutClarifications?: boolean } = {},
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const pairs = Math.ceil(WA_ASSISTANT_LIMITS.historyTurns / 2)
  const query = db(T)
    .where({ recipientId, status: 'answered', kind: 'text' })
    .where('id', '<', beforeJobId)
    .where('createdAt', '>', new Date(now.getTime() - WA_ASSISTANT_LIMITS.historyMs))
    .whereNotNull('question')
  if (opts.withoutClarifications) query.where((q) => q.whereNull('stopReason').orWhereNot('stopReason', 'like', '%\\_clarify\\_%'))
  const rows = (await query.orderBy('id', 'desc').limit(pairs).select('question', 'answerHeadline')) as { question: string; answerHeadline: string | null }[]
  const turns: { role: 'user' | 'assistant'; content: string }[] = []
  for (const r of rows.reverse()) {
    turns.push({ role: 'user', content: r.question })
    if (r.answerHeadline) turns.push({ role: 'assistant', content: r.answerHeadline })
  }
  return turns.slice(-WA_ASSISTANT_LIMITS.historyTurns)
}

/**
 * Usage counters for the limits: messages received BEFORE this one (lower id),
 * so "the first message over the limit" is well defined even while later
 * messages are already queued. Spend counts every other job today.
 */
export async function waAssistantUsage(job: { id: number; recipientId: number; agencyId: number }, now: Date): Promise<{ senderLastHour: number; agencyToday: number; agencySpendTodayUsd: number }> {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000)
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const [sender, agency] = await Promise.all([
    db(T).where({ recipientId: job.recipientId }).where('id', '<', job.id).where('createdAt', '>', hourAgo).count<{ count: string }>('id as count').first(),
    db(T)
      .where({ agencyId: job.agencyId })
      .whereNot({ id: job.id })
      .where('createdAt', '>=', dayStart)
      .select(db.raw('count(*) FILTER (WHERE id < ?)::int AS count', [job.id]), db.raw('COALESCE(sum("costUsd"), 0)::float AS spend'))
      .first(),
  ])
  return {
    senderLastHour: Number(sender?.count ?? 0),
    agencyToday: Number((agency as { count?: number } | undefined)?.count ?? 0),
    agencySpendTodayUsd: Number((agency as { spend?: number } | undefined)?.spend ?? 0),
  }
}

/** Commit `sending` BEFORE the Graph call. False when the reply was already attempted. */
/**
 * Abuse-guard counts for the founder (technical protection, never a quota):
 * this recipient's jobs in the last minute and the last hour, and the length of
 * the CONSECUTIVE run of earlier text jobs identical to this one within 10
 * minutes. Any other job in between (a different text, a button tap) ends the
 * run, so repeated legitimate testing interleaved with taps never counts as a loop.
 */
export async function founderAbuseCounts(
  job: { id: number; recipientId: number; kind: string; question: string | null },
  now: Date,
): Promise<{ lastMinute: number; lastHour: number; identicalRun: number }> {
  const before = (ms: number) => new Date(now.getTime() - ms)
  const count = async (sinceMs: number) =>
    Number(((await db(T).where({ recipientId: job.recipientId }).where('id', '<', job.id).where('createdAt', '>', before(sinceMs)).count<{ n: string }[]>('id as n')) as { n: string }[])[0].n)
  const [lastMinute, lastHour] = await Promise.all([count(60_000), count(60 * 60_000)])
  let identicalRun = 0
  const text = job.kind === 'text' ? squashText(job.question) : ''
  if (text) {
    const recent = (await db(T).where({ recipientId: job.recipientId }).where('id', '<', job.id).where('createdAt', '>', before(10 * 60_000))
      .orderBy('id', 'desc').limit(10).select('kind', 'question')) as { kind: string; question: string | null }[]
    for (const r of recent) {
      if (r.kind !== 'text' || squashText(r.question) !== text) break
      identicalRun++
    }
  }
  return { lastMinute, lastHour, identicalRun }
}

const squashText = (q: string | null) => (q ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()

export async function markWaAssistantReplySending(jobId: number): Promise<boolean> {
  const n = await db(T).where({ id: jobId, status: 'running' }).whereNull('replyState').update({ replyState: 'sending', updatedAt: db.fn.now() })
  return n === 1
}

export type WaAssistantFinish = {
  status: 'answered' | 'refused' | 'failed' | 'expired'
  refusalReason?: string | null
  stopReason?: string | null
  answerHeadline?: string | null
  costUsd?: number
  durationMs?: number
  reply?: { state: 'sent' | 'failed' | 'unknown' | 'skipped'; wamid?: string | null; errorCode?: string | null }
}

/** Close a running job. Guarded on `running`, so a reaped job is never overwritten. */
export async function finishWaAssistantJob(jobId: number, f: WaAssistantFinish): Promise<void> {
  await db(T)
    .where({ id: jobId, status: 'running' })
    .update({
      status: f.status,
      refusalReason: f.refusalReason ?? null,
      stopReason: f.stopReason ?? null,
      answerHeadline: f.answerHeadline ? f.answerHeadline.slice(0, 600) : null,
      costUsd: f.costUsd ?? 0,
      durationMs: f.durationMs ?? null,
      ...(f.reply ? { replyState: f.reply.state, replyWamid: f.reply.wamid ?? null, replyErrorCode: f.reply.errorCode ?? null } : {}),
      lockedAt: null,
      updatedAt: db.fn.now(),
    })
}

/** Memory is bounded in time: text older than the window is cleared, the ledger kept. */
export async function purgeWaAssistantText(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - WA_ASSISTANT_LIMITS.historyMs)
  const rows = await db(T)
    .where('createdAt', '<', cutoff)
    .where((q) => q.whereNotNull('question').orWhereNotNull('answerHeadline'))
    .whereNotIn('status', ['queued', 'running'])
    .update({ question: null, answerHeadline: null, updatedAt: db.fn.now() })
    .returning('id')
  return rows.length
}
