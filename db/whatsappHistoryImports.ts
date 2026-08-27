import { createHash } from 'node:crypto'
import type { Knex } from 'knex'
import { db } from '@/config/db'
import type { ParsedHistoryEvent } from '@/lib/whatsapp/historyEvent'

/**
 * whatsapp_history_imports — storage and lifecycle for history deliveries.
 *
 * The shape is `db/ai/signalJobs.ts`', almost line for line: `FOR UPDATE SKIP
 * LOCKED` claim, lease columns, `attempts + 1` at claim, exponential backoff,
 * terminal state at `maxAttempts`, stale-lease reclaim. Nothing about the queue
 * mechanics is new — only the payload and the outcome vocabulary are.
 *
 * This module owns storage. It owns no processing: nothing here parses,
 * persists a message, or decides policy. Draining is
 * `lib/inbox/history/importWorker.ts`.
 *
 * NOTE ON SIZE (architecture-rules §6): ~315 lines, over the 250 soft limit and
 * intentionally so. It is one concern — the storage and lifecycle of one table —
 * expressed as eight small independent statements plus a header, which is
 * exactly the shape and size of `db/ai/signalJobs.ts` (~285) and
 * `db/autoResponseJobs.ts`. Splitting a DAO by verb would mean two files to
 * answer "what can happen to a delivery" and would let the status vocabulary
 * drift between them. The extraction trigger is a SECOND concern arriving here
 * (retention, metrics), not the next lifecycle verb.
 */

export type HistoryImportKind = 'chunk' | 'media_followup' | 'error'

export type HistoryImportStatus =
  | 'received'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'deferred'
  | 'error'
  | 'failed'

export type HistoryImportRow = {
  id: number
  agencyId: number
  phoneNumberId: string
  kind: HistoryImportKind
  importKey: string
  phase: number | null
  chunkOrder: number | null
  progress: number | null
  payload: unknown
  status: HistoryImportStatus
  attempts: number
  maxAttempts: number
  /** Messages of this delivery already durably persisted, in payload order. */
  cursor: number
}

export type HistoryImportCounts = {
  messagesSeen: number
  messagesInserted: number
  messagesDuplicate: number
  messagesSkipped: number
}

function toRow(r: Record<string, unknown>): HistoryImportRow {
  return {
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    phoneNumberId: String(r.phoneNumberId),
    kind: r.kind as HistoryImportKind,
    importKey: String(r.importKey),
    phase: r.phase == null ? null : Number(r.phase),
    chunkOrder: r.chunkOrder == null ? null : Number(r.chunkOrder),
    progress: r.progress == null ? null : Number(r.progress),
    payload: r.payload,
    status: r.status as HistoryImportStatus,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.maxAttempts),
    cursor: Number(r.cursor ?? 0),
  }
}

/**
 * The delivery identity, derived deterministically.
 *
 * META PUBLISHES NO DELIVERY ID for history webhooks, so this key is CHOSEN.
 *
 * A chunk is keyed by `chunk:{phase}:{chunkOrder}` — the semantic identity Meta
 * does document. That is deliberately stronger than hashing the body: a
 * redelivery whose `progress` has advanced is still THE SAME CHUNK, and hashing
 * would import it twice.
 *
 * The media-follow-up and error shapes carry neither phase nor chunk order, so
 * they fall back to a hash of the raw payload. That makes an identical
 * redelivery a no-op, which is the guarantee available without an id from Meta;
 * it is honestly weaker, and the wamid uniqueness underneath is what actually
 * prevents duplicate messages.
 *
 * A chunk missing either field also falls back to the hash rather than keying on
 * a null — two unrelated chunks must never collide onto `chunk:null:null`.
 */
export function historyImportKey(event: ParsedHistoryEvent, rawValue: unknown): string {
  if (event.kind === 'history_chunk' && event.phase !== null && event.chunkOrder !== null) {
    return `chunk:${event.phase}:${event.chunkOrder}`
  }
  const kind = event.kind === 'history_media_followup' ? 'media' : event.kind === 'history_error' ? 'error' : 'chunk'
  return `${kind}:${createHash('sha256').update(JSON.stringify(rawValue ?? null)).digest('hex')}`
}

const KIND: Record<ParsedHistoryEvent['kind'], HistoryImportKind> = {
  history_chunk: 'chunk',
  history_media_followup: 'media_followup',
  history_error: 'error',
}

export type RecordResult = { id: number; inserted: boolean }

/**
 * RAW-FIRST. Write the delivery down before anything touches the inbox.
 *
 * `ON CONFLICT DO NOTHING` against `(agencyId, phoneNumberId, importKey)` makes
 * a redelivery a no-op at the DATABASE, not a check-then-insert race in
 * application code — two concurrent deliveries of the same chunk cannot both
 * become work.
 *
 * `agencyId` is passed in already resolved from `phone_number_id`; it is never
 * read from the payload.
 */
export async function recordHistoryDelivery(
  args: {
    agencyId: number
    phoneNumberId: string
    event: ParsedHistoryEvent
    rawValue: unknown
    maxAttempts?: number
  },
  executor: Knex | Knex.Transaction = db,
): Promise<RecordResult> {
  const { agencyId, phoneNumberId, event, rawValue } = args
  const importKey = historyImportKey(event, rawValue)
  const chunk = event.kind === 'history_chunk' ? event : null

  const rows = await executor('whatsapp_history_imports')
    .insert({
      agencyId,
      phoneNumberId,
      kind: KIND[event.kind],
      importKey,
      phase: chunk?.phase ?? null,
      chunkOrder: chunk?.chunkOrder ?? null,
      progress: chunk?.progress ?? null,
      payload: JSON.stringify(rawValue ?? null),
      maxAttempts: args.maxAttempts ?? 5,
    })
    .onConflict(['agencyId', 'phoneNumberId', 'importKey'])
    .ignore()
    .returning('id')

  if (rows.length) return { id: Number(rows[0].id), inserted: true }

  const existing = await executor('whatsapp_history_imports')
    .where({ agencyId, phoneNumberId, importKey })
    .first('id')
  return { id: Number(existing.id), inserted: false }
}

/**
 * Claim due deliveries, leasing them to one worker.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes concurrent workers safe: a row another
 * transaction holds is skipped rather than waited on, so two workers never lease
 * the same delivery and neither blocks. `attempts + 1` happens HERE, at the
 * claim, so a worker that dies mid-import still consumed an attempt.
 *
 * ORDERED BY `nextAttemptAt`, id — NOT by phase or chunkOrder. Chunks are
 * documented to arrive out of order and there is nothing to gain by processing
 * them in order: each is independent, and message chronology comes from
 * `channelTimestamp`, never from import order.
 *
 * THE ALLOWLIST IS APPLIED AT THE CLAIM, not at receive. A delivery for a
 * number that is not activated stays `received` — durable, unprocessed, and
 * claimable the moment the number is added. Filtering at receive would mean
 * DROPPING an archive that cannot be re-requested, which is the one mistake this
 * whole wave exists to prevent. Deny-by-default: `allowPhoneNumberIds: []`
 * claims nothing at all.
 */
export async function claimHistoryImports(
  workerId: string,
  limit: number,
  opts: { allowPhoneNumberIds: 'all' | string[] },
  executor: Knex | Knex.Transaction = db,
): Promise<HistoryImportRow[]> {
  const allow = opts.allowPhoneNumberIds
  if (allow !== 'all' && allow.length === 0) return []

  const res = await executor.raw(
    `
    UPDATE whatsapp_history_imports j
       SET status = 'processing', "lockedAt" = now(), "lockedBy" = ?,
           attempts = attempts + 1, "startedAt" = COALESCE(j."startedAt", now()),
           "updatedAt" = now()
     WHERE j.id IN (
       SELECT id FROM whatsapp_history_imports
        WHERE status = 'received' AND "nextAttemptAt" <= now()
          AND (?::boolean OR "phoneNumberId" = ANY(?))
        ORDER BY "nextAttemptAt" ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ?
     )
     RETURNING j.id, j."agencyId", j."phoneNumberId", j.kind, j."importKey", j.phase,
               j."chunkOrder", j.progress, j.payload, j.status, j.attempts, j."maxAttempts", j.cursor
  `,
    [workerId, allow === 'all', allow === 'all' ? [] : allow, limit],
  )
  return (res.rows ?? []).map(toRow)
}

/**
 * Settle a delivery in a terminal-for-now state, only while still leased — so a
 * reclaimed row cannot be settled twice.
 *
 * `partial` is a real outcome, not a failure: a chunk whose messages were all
 * processed but some could not be attached (no conversation exists) is DONE, and
 * retrying it would produce the identical result forever.
 */
export async function settleHistoryImport(
  id: number,
  status: 'completed' | 'partial' | 'deferred' | 'error',
  counts: Partial<HistoryImportCounts> = {},
  note: string | null = null,
  cursor?: number,
): Promise<boolean> {
  const n = await db('whatsapp_history_imports')
    .where({ id, status: 'processing' })
    .update({
      status,
      // ACCUMULATED, not overwritten. A delivery may be settled after several
      // resumed runs (F-1), and each run only knows about its own slice; an
      // assignment would report the last slice as if it were the whole import.
      messagesSeen: db.raw('"messagesSeen" + ?', [counts.messagesSeen ?? 0]),
      messagesInserted: db.raw('"messagesInserted" + ?', [counts.messagesInserted ?? 0]),
      messagesDuplicate: db.raw('"messagesDuplicate" + ?', [counts.messagesDuplicate ?? 0]),
      messagesSkipped: db.raw('"messagesSkipped" + ?', [counts.messagesSkipped ?? 0]),
      ...(cursor === undefined ? {} : { cursor }),
      lastError: note,
      completedAt: db.fn.now(),
      lockedAt: null,
      lockedBy: null,
      updatedAt: db.fn.now(),
    })
  return Number(n) > 0
}

/**
 * Advance the cursor mid-run while KEEPING the lease.
 *
 * `checkpointHistoryImport` releases the delivery so another run can continue
 * it; this one does not — the worker is still going, and handing the row back
 * mid-flight would let a second worker duplicate the remaining work. It exists
 * only to narrow the crash window: progress written every N messages means a
 * process death re-does at most N deduplicated messages instead of the whole
 * delivery.
 *
 * Guarded on `status = 'processing'`, so a row reclaimed out from under a stalled
 * worker cannot have its cursor moved by that worker afterwards.
 */
export async function progressHistoryImport(
  id: number,
  cursor: number,
  counts: Partial<HistoryImportCounts> = {},
): Promise<boolean> {
  const n = await db('whatsapp_history_imports')
    .where({ id, status: 'processing' })
    .update({
      cursor,
      messagesSeen: db.raw('"messagesSeen" + ?', [counts.messagesSeen ?? 0]),
      messagesInserted: db.raw('"messagesInserted" + ?', [counts.messagesInserted ?? 0]),
      messagesDuplicate: db.raw('"messagesDuplicate" + ?', [counts.messagesDuplicate ?? 0]),
      messagesSkipped: db.raw('"messagesSkipped" + ?', [counts.messagesSkipped ?? 0]),
      updatedAt: db.fn.now(),
    })
  return Number(n) > 0
}

/**
 * Save partial progress and release the lease so the SAME delivery is picked up
 * again immediately (Wave 2A.2g.1, F-1).
 *
 * A checkpoint is NOT a failure, and the difference is load-bearing:
 *
 *   - `attempts` is reset to 0. It counts CONSECUTIVE failures, and a run that
 *     imported messages did not fail. Without this reset a delivery needing more
 *     checkpoints than `maxAttempts` would dead-letter for the crime of being
 *     large — the precise defect F-1 describes.
 *   - `nextAttemptAt` is now, not a backoff. There is nothing to wait for.
 *   - `completedAt` stays NULL. The delivery is not finished and must never look
 *     finished.
 *
 * The cursor is written in the SAME statement that releases the lease, and only
 * ever after the messages it covers are committed. A crash between commits
 * re-does a bounded amount of work, which message-level dedup absorbs; it can
 * never skip a message.
 */
export async function checkpointHistoryImport(
  id: number,
  cursor: number,
  counts: Partial<HistoryImportCounts> = {},
): Promise<boolean> {
  const n = await db('whatsapp_history_imports')
    .where({ id, status: 'processing' })
    .update({
      status: 'received',
      cursor,
      messagesSeen: db.raw('"messagesSeen" + ?', [counts.messagesSeen ?? 0]),
      messagesInserted: db.raw('"messagesInserted" + ?', [counts.messagesInserted ?? 0]),
      messagesDuplicate: db.raw('"messagesDuplicate" + ?', [counts.messagesDuplicate ?? 0]),
      messagesSkipped: db.raw('"messagesSkipped" + ?', [counts.messagesSkipped ?? 0]),
      attempts: 0,
      nextAttemptAt: db.fn.now(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      updatedAt: db.fn.now(),
    })
  return Number(n) > 0
}

/**
 * A RETRYABLE failure: back to `received` behind an exponential backoff until
 * the attempts budget is spent, then terminal. The curve is `signalJobs`':
 * 2s, 4s, 8s… capped at 15 minutes.
 */
export async function failHistoryImport(id: number, error: string): Promise<void> {
  await db.raw(
    `
    UPDATE whatsapp_history_imports
       SET status = CASE WHEN attempts >= "maxAttempts" THEN 'failed' ELSE 'received' END,
           "completedAt" = CASE WHEN attempts >= "maxAttempts" THEN now() ELSE NULL END,
           "lastError" = ?, "lockedAt" = NULL, "lockedBy" = NULL,
           "nextAttemptAt" = now() + make_interval(secs => LEAST(POWER(2, LEAST(attempts, 10))::int, 900)),
           "updatedAt" = now()
     WHERE id = ?
  `,
    [error, id],
  )
}

/** Recover deliveries whose worker died holding the lease. Attempts are NOT given back. */
export async function reclaimStaleHistoryImports(leaseMs: number, now: number = Date.now()): Promise<number> {
  const res = await db.raw(
    `
    UPDATE whatsapp_history_imports
       SET status = CASE WHEN attempts >= "maxAttempts" THEN 'failed' ELSE 'received' END,
           "lockedAt" = NULL, "lockedBy" = NULL,
           "lastError" = 'lease-expired-reclaimed',
           "nextAttemptAt" = now(), "updatedAt" = now()
     WHERE status = 'processing' AND "lockedAt" < ?
     RETURNING id
  `,
    [new Date(now - leaseMs)],
  )
  return res.rows?.length ?? 0
}

/**
 * What we can honestly say about one connection's archive.
 *
 * DELIBERATELY NOT A BOOLEAN "complete". Meta documents `progress` reaching 100
 * and three phases, but publishes no total chunk count and states chunks may
 * arrive out of order — so nothing here can prove every chunk was received.
 * `metaReportedComplete` means exactly what it says: a delivery arrived carrying
 * progress 100. That is Meta's claim, not our verification.
 */
export async function historyImportSummary(
  agencyId: number,
  phoneNumberId: string,
): Promise<{
  byStatus: Record<string, number>
  metaReportedComplete: boolean
  phasesSeen: number[]
  counts: HistoryImportCounts
  /** Deliveries that needed more than one attempt, and the worst attempt count. */
  retried: number
  maxAttempts: number
}> {
  const rows = (await db('whatsapp_history_imports')
    .where({ agencyId, phoneNumberId })
    .select(
      'status',
      'phase',
      'progress',
      'attempts',
      'messagesSeen',
      'messagesInserted',
      'messagesDuplicate',
      'messagesSkipped',
    )) as Record<
    string,
    unknown
  >[]

  const byStatus: Record<string, number> = {}
  const phases = new Set<number>()
  const counts: HistoryImportCounts = {
    messagesSeen: 0,
    messagesInserted: 0,
    messagesDuplicate: 0,
    messagesSkipped: 0,
  }

  let retried = 0
  let maxAttempts = 0

  for (const r of rows) {
    const s = String(r.status)
    byStatus[s] = (byStatus[s] ?? 0) + 1
    const attempts = Number(r.attempts ?? 0)
    // A first attempt is not a retry; anything beyond it is the signal that
    // distinguishes a clean import from one that fought its way through.
    if (attempts > 1) retried += 1
    if (attempts > maxAttempts) maxAttempts = attempts
    if (r.phase != null) phases.add(Number(r.phase))
    counts.messagesSeen += Number(r.messagesSeen ?? 0)
    counts.messagesInserted += Number(r.messagesInserted ?? 0)
    counts.messagesDuplicate += Number(r.messagesDuplicate ?? 0)
    counts.messagesSkipped += Number(r.messagesSkipped ?? 0)
  }

  return {
    byStatus,
    metaReportedComplete: rows.some((r) => Number(r.progress) === 100),
    phasesSeen: [...phases].sort((a, b) => a - b),
    counts,
    retried,
    maxAttempts,
  }
}
