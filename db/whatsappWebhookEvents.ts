import { db } from '@/config/db'

/**
 * whatsapp_webhook_events — storage and lifecycle, the same lifecycle as
 * db/messengerWebhookEvents.ts: leased claim with SKIP LOCKED, attempts counted at
 * claim, exponential backoff, terminal `failed`, stale-lease reclaim, requeue, prune.
 * Plus one rule of its own: a receipt is not claimed while an EARLIER receipt for the
 * same customer is still pending, so one customer's events apply in order.
 * Processing lives in lib/whatsapp/webhook/worker.ts.
 */

export type WhatsappEventKind = 'message' | 'echo' | 'status'

export type NewWhatsappEvent = {
  agencyId: number
  phoneNumberId: string
  eventKey: string
  kind: WhatsappEventKind
  orderingKey: string | null
  payload: unknown
}

export type WhatsappEventRow = {
  id: number
  agencyId: number
  phoneNumberId: string
  eventKey: string
  kind: WhatsappEventKind
  orderingKey: string | null
  payload: unknown
  attempts: number
  maxAttempts: number
}

const TABLE = 'whatsapp_webhook_events'

/**
 * Record a delivery's events in ONE statement. A redelivered event collides on
 * ("phoneNumberId","eventKey") and is skipped. Returns the ids of rows actually
 * inserted. Throws on a write failure: the caller must then refuse the webhook (503).
 */
export async function recordWhatsappEvents(events: NewWhatsappEvent[]): Promise<{ insertedIds: number[]; duplicates: number }> {
  if (events.length === 0) return { insertedIds: [], duplicates: 0 }
  const rows = (await db(TABLE)
    .insert(
      events.map((e) => ({
        agencyId: e.agencyId,
        phoneNumberId: e.phoneNumberId,
        eventKey: e.eventKey,
        kind: e.kind,
        orderingKey: e.orderingKey,
        payload: JSON.stringify(e.payload),
      })),
    )
    .onConflict(['phoneNumberId', 'eventKey'])
    .ignore()
    .returning('id')) as { id: number | string }[]
  const insertedIds = rows.map((r) => Number(r.id))
  return { insertedIds, duplicates: events.length - insertedIds.length }
}

function toRow(r: Record<string, unknown>): WhatsappEventRow {
  return {
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    phoneNumberId: String(r.phoneNumberId),
    eventKey: String(r.eventKey),
    kind: r.kind as WhatsappEventKind,
    orderingKey: (r.orderingKey as string | null) ?? null,
    payload: r.payload,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.maxAttempts),
  }
}

/**
 * Lease due receipts to one worker. `ids` narrows the claim to a delivery's own
 * receipts (the post-response kick); without it the oldest due receipts are claimed
 * (the cron backstop). `attempts + 1` happens here, so a worker that dies mid-way still
 * spent an attempt. A receipt whose customer has an EARLIER receipt still received or
 * processing is skipped this round. A terminal `failed` predecessor does not block.
 */
export async function claimWhatsappEvents(workerId: string, limit: number, opts: { ids?: number[] } = {}): Promise<WhatsappEventRow[]> {
  const ids = opts.ids
  if (ids && ids.length === 0) return []
  const res = await db.raw(
    `
    UPDATE ${TABLE} e
       SET status = 'processing', "lockedAt" = now(), "lockedBy" = ?,
           attempts = attempts + 1, "updatedAt" = now()
     WHERE e.id IN (
       SELECT c.id FROM ${TABLE} c
        WHERE c.status = 'received' AND c."nextAttemptAt" <= now()
          AND (?::boolean OR c.id = ANY(?::bigint[]))
          AND (
            c."orderingKey" IS NULL OR NOT EXISTS (
              SELECT 1 FROM ${TABLE} p
               WHERE p."phoneNumberId" = c."phoneNumberId"
                 AND p."orderingKey" = c."orderingKey"
                 AND p.id < c.id
                 AND p.status IN ('received','processing')
            )
          )
        ORDER BY c.id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ?
     )
     RETURNING e.id, e."agencyId", e."phoneNumberId", e."eventKey", e.kind, e."orderingKey", e.payload, e.attempts, e."maxAttempts"
  `,
    [workerId, !ids, ids ?? [], limit],
  )
  return ((res.rows ?? []) as Record<string, unknown>[]).map(toRow).sort((a, b) => a.id - b.id)
}

/** Settle while still leased, so a reclaimed receipt cannot be settled twice. */
export async function settleWhatsappEvent(id: number, status: 'processed' | 'ignored', outcome: string): Promise<boolean> {
  const n = await db(TABLE)
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
 * A failed attempt: back to `received` behind an exponential backoff (2s, 4s, 8s…
 * capped at 15 minutes) until the budget is spent, then terminal `failed`: kept,
 * visible, and requeueable. `error` must be a classification only.
 *
 * Returns true only when THIS call moved the receipt to terminal `failed`, so the
 * caller reports each new terminal failure exactly once.
 */
export async function failWhatsappEvent(id: number, error: string): Promise<boolean> {
  const res = await db.raw(
    `
    UPDATE ${TABLE}
       SET status = CASE WHEN attempts >= "maxAttempts" THEN 'failed' ELSE 'received' END,
           "lastError" = ?, "lockedAt" = NULL, "lockedBy" = NULL,
           "nextAttemptAt" = now() + make_interval(secs => LEAST(POWER(2, LEAST(attempts, 10))::int, 900)),
           "updatedAt" = now()
     WHERE id = ? AND status = 'processing'
     RETURNING status
  `,
    [error.slice(0, 200), id],
  )
  return ((res.rows ?? []) as { status: string }[]).some((r) => r.status === 'failed')
}

/**
 * Recover receipts whose worker died holding the lease. Attempts are not given back.
 * `failed` counts the receipts THIS call moved to terminal `failed`.
 */
export async function reclaimStaleWhatsappEvents(leaseMs: number, now: number = Date.now()): Promise<{ reclaimed: number; failed: number }> {
  const res = await db.raw(
    `
    UPDATE ${TABLE}
       SET status = CASE WHEN attempts >= "maxAttempts" THEN 'failed' ELSE 'received' END,
           "lockedAt" = NULL, "lockedBy" = NULL, "lastError" = 'lease-expired-reclaimed',
           "nextAttemptAt" = now(), "updatedAt" = now()
     WHERE status = 'processing' AND "lockedAt" < ?
     RETURNING id, status
  `,
    [new Date(now - leaseMs)],
  )
  const rows = (res.rows ?? []) as { status: string }[]
  return { reclaimed: rows.length, failed: rows.filter((r) => r.status === 'failed').length }
}

/** Operator recovery: put terminal `failed` receipts back with a fresh budget. Scoped, never implicit "all". */
export async function requeueFailedWhatsappEvents(scope: { ids: number[] } | { agencyId: number }): Promise<number> {
  const q = db(TABLE).where({ status: 'failed' })
  if ('ids' in scope) {
    if (scope.ids.length === 0) return 0
    q.whereIn('id', scope.ids)
  } else {
    q.where({ agencyId: scope.agencyId })
  }
  return Number(await q.update({ status: 'received', attempts: 0, nextAttemptAt: db.fn.now(), lastError: null, updatedAt: db.fn.now() }))
}

/** Delete settled receipts past retention, in bounded batches. Failed receipts are kept. */
export async function pruneSettledWhatsappEvents(retentionDays: number, limit = 500): Promise<number> {
  const res = await db.raw(
    `
    DELETE FROM ${TABLE}
     WHERE id IN (
       SELECT id FROM ${TABLE}
        WHERE status IN ('processed','ignored') AND "processedAt" < now() - make_interval(days => ?)
        LIMIT ?
     )
     RETURNING id
  `,
    [retentionDays, limit],
  )
  return res.rows?.length ?? 0
}

/** Counts per status plus the age of the oldest waiting receipt, for the cron's alerts. */
export async function whatsappEventHealth(): Promise<{ counts: Record<string, number>; oldestReceivedSeconds: number | null }> {
  const rows = (await db(TABLE).select('status').count('* as n').groupBy('status')) as { status: string; n: string | number }[]
  const counts = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]))
  const oldest = await db(TABLE).where({ status: 'received' }).min('receivedAt as at').first()
  const at = (oldest as { at?: Date | string | null } | undefined)?.at
  return { counts, oldestReceivedSeconds: at ? Math.round((Date.now() - new Date(at).getTime()) / 1000) : null }
}
