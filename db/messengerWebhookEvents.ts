import type { Knex } from 'knex'
import { db } from '@/config/db'

/**
 * messenger_webhook_events — storage and lifecycle. The lifecycle is
 * `db/whatsappHistoryImports.ts`' (and `db/ai/signalJobs.ts`'): leased claim
 * with SKIP LOCKED, attempts counted at claim, exponential backoff, terminal
 * `failed`, stale-lease reclaim. This module owns storage only; processing is
 * `lib/facebook/messenger/eventWorker.ts`.
 */

export type MessengerEventStatus = 'received' | 'processing' | 'processed' | 'ignored' | 'failed'

export type MessengerEventRow = {
  id: number
  agencyId: number
  pageId: string
  eventKey: string
  kind: 'inbound' | 'echo'
  payload: unknown
  attempts: number
  maxAttempts: number
}

export type NewMessengerEvent = {
  agencyId: number
  pageId: string
  eventKey: string
  /** Widened in 20260923000001 alongside the table's CHECK constraint. */
  kind: 'inbound' | 'echo' | 'delivery' | 'read' | 'postback' | 'referral' | 'reaction'
  payload: unknown
}

function toRow(r: Record<string, unknown>): MessengerEventRow {
  return {
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    pageId: String(r.pageId),
    eventKey: String(r.eventKey),
    kind: r.kind as MessengerEventRow['kind'],
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.maxAttempts),
  }
}

/**
 * Write a delivery's events down in ONE statement — all of them or none. A
 * redelivered event collides on ("pageId", "eventKey") and is not re-inserted.
 * Returns the ids that were newly recorded; throws if the write fails, which
 * the webhook must answer with a non-2xx.
 */
export async function recordMessengerEvents(
  events: NewMessengerEvent[],
  executor: Knex | Knex.Transaction = db,
): Promise<{ recordedIds: number[]; duplicates: number }> {
  if (events.length === 0) return { recordedIds: [], duplicates: 0 }
  const rows = await executor('messenger_webhook_events')
    .insert(
      events.map((e) => ({
        agencyId: e.agencyId,
        pageId: e.pageId,
        eventKey: e.eventKey,
        kind: e.kind,
        payload: JSON.stringify(e.payload ?? null),
      })),
    )
    .onConflict(['pageId', 'eventKey'])
    .ignore()
    .returning('id')
  const recordedIds = rows.map((r: { id: number | string }) => Number(r.id))
  return { recordedIds, duplicates: events.length - recordedIds.length }
}

/**
 * Lease due receipts to one worker. `ids` narrows the claim to a delivery's own
 * receipts (the post-response kick); without it the oldest due receipts are
 * claimed (the cron backstop). `attempts + 1` happens here, so a worker that
 * dies mid-processing still consumed an attempt.
 */
export async function claimMessengerEvents(
  workerId: string,
  limit: number,
  opts: { ids?: number[] } = {},
  executor: Knex | Knex.Transaction = db,
): Promise<MessengerEventRow[]> {
  const ids = opts.ids
  if (ids && ids.length === 0) return []
  const res = await executor.raw(
    `
    UPDATE messenger_webhook_events e
       SET status = 'processing', "lockedAt" = now(), "lockedBy" = ?,
           attempts = attempts + 1, "updatedAt" = now()
     WHERE e.id IN (
       SELECT id FROM messenger_webhook_events
        WHERE status = 'received' AND "nextAttemptAt" <= now()
          AND (?::boolean OR id = ANY(?::bigint[]))
        ORDER BY "nextAttemptAt" ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ?
     )
     RETURNING e.id, e."agencyId", e."pageId", e."eventKey", e.kind, e.payload, e.attempts, e."maxAttempts"
  `,
    [workerId, !ids, ids ?? [], limit],
  )
  return (res.rows ?? []).map(toRow)
}

/** Settle while still leased, so a reclaimed receipt cannot be settled twice. */
export async function settleMessengerEvent(
  id: number,
  status: 'processed' | 'ignored',
  outcome: string,
): Promise<boolean> {
  const n = await db('messenger_webhook_events')
    .where({ id, status: 'processing' })
    .update({
      status,
      outcome: outcome.slice(0, 64),
      lastError: null,
      lockedAt: null,
      lockedBy: null,
      processedAt: db.fn.now(),
      updatedAt: db.fn.now(),
    })
  return Number(n) > 0
}

/**
 * A failed attempt: back to `received` behind an exponential backoff (2s, 4s,
 * 8s… capped at 15 minutes) until the budget is spent, then terminal `failed`
 * — kept, visible, and requeueable. `error` must be a classification only.
 */
export async function failMessengerEvent(id: number, error: string): Promise<void> {
  await db.raw(
    `
    UPDATE messenger_webhook_events
       SET status = CASE WHEN attempts >= "maxAttempts" THEN 'failed' ELSE 'received' END,
           "lastError" = ?, "lockedAt" = NULL, "lockedBy" = NULL,
           "nextAttemptAt" = now() + make_interval(secs => LEAST(POWER(2, LEAST(attempts, 10))::int, 900)),
           "updatedAt" = now()
     WHERE id = ? AND status = 'processing'
  `,
    [error.slice(0, 200), id],
  )
}

/** Recover receipts whose worker died holding the lease. Attempts are not given back. */
export async function reclaimStaleMessengerEvents(leaseMs: number, now: number = Date.now()): Promise<number> {
  const res = await db.raw(
    `
    UPDATE messenger_webhook_events
       SET status = CASE WHEN attempts >= "maxAttempts" THEN 'failed' ELSE 'received' END,
           "lockedAt" = NULL, "lockedBy" = NULL, "lastError" = 'lease-expired-reclaimed',
           "nextAttemptAt" = now(), "updatedAt" = now()
     WHERE status = 'processing' AND "lockedAt" < ?
     RETURNING id
  `,
    [new Date(now - leaseMs)],
  )
  return res.rows?.length ?? 0
}

/**
 * Operator recovery: put terminal `failed` receipts back in the queue with a
 * fresh attempt budget (e.g. after fixing the cause). Scoped by id list or by
 * agency; never "everything" implicitly.
 */
export async function requeueFailedMessengerEvents(scope: { ids: number[] } | { agencyId: number }): Promise<number> {
  const q = db('messenger_webhook_events').where({ status: 'failed' })
  if ('ids' in scope) {
    if (scope.ids.length === 0) return 0
    q.whereIn('id', scope.ids)
  } else {
    q.where({ agencyId: scope.agencyId })
  }
  const n = await q.update({
    status: 'received',
    attempts: 0,
    nextAttemptAt: db.fn.now(),
    lastError: null,
    updatedAt: db.fn.now(),
  })
  return Number(n)
}

/** Delete settled receipts past retention, in bounded batches. Failed receipts are kept. */
export async function pruneSettledMessengerEvents(retentionDays: number, limit = 500): Promise<number> {
  const res = await db.raw(
    `
    DELETE FROM messenger_webhook_events
     WHERE id IN (
       SELECT id FROM messenger_webhook_events
        WHERE status IN ('processed','ignored') AND "processedAt" < now() - make_interval(days => ?)
        LIMIT ?
     )
     RETURNING id
  `,
    [retentionDays, limit],
  )
  return res.rows?.length ?? 0
}

/** Counts by status — an operational signal with no content. */
export async function messengerEventStatusCounts(): Promise<Record<string, number>> {
  const rows = (await db('messenger_webhook_events').select('status').count({ n: '*' }).groupBy('status')) as {
    status: string
    n: string | number
  }[]
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]))
}
