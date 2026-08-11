import type { Knex } from 'knex'
import { db } from '@/config/db'
import type { EntityType, NotificationPayload, NotificationType } from '@/lib/notifications/types'

/**
 * notification_jobs data access — the queue. Spec §3, §14, §21.2.
 *
 * Deliberately a clone of db/automations/jobs.ts in shape: lease + SKIP LOCKED
 * claim, linear backoff, dead-letter at maxAttempts, terminal pruning. That
 * engine's queue is already load-bearing in production here, and reusing a
 * proven execution model in a new bounded domain beats inventing a second one
 * (spec §3). Separate TABLE, same mechanics.
 */

export interface NotificationJob {
  id: number
  agencyId: number
  type: NotificationType
  eventKey: string
  actorUserId: number | null
  entityType: EntityType
  entityId: number
  payload: NotificationPayload
  attempts: number
  maxAttempts: number
  createdAt: string
}

export type EnqueueNotificationJobArgs = {
  agencyId: number
  type: NotificationType
  eventKey: string
  actorUserId: number | null
  entityType: EntityType
  entityId: number
  payload: NotificationPayload
}

/**
 * THE enqueue. One INSERT, no joins, no fan-out, no recipient resolution — all
 * of that is the worker's job, because this statement runs inside the Facebook
 * webhook and inside protected server actions, and it must not measurably change
 * their latency (spec §3).
 *
 * `ON CONFLICT ("eventKey") DO NOTHING` is what absorbs webhook retries and what
 * makes the reconciliation sweep idempotent (spec §14.3).
 *
 * Takes a query builder rather than reaching for `db`, so a caller inside a
 * transaction gets an enqueue that COMMITS OR ROLLS BACK WITH the business
 * write (spec §14.1).
 */
export function enqueueNotificationJobQuery(q: Knex.Transaction | Knex, args: EnqueueNotificationJobArgs) {
  return q.raw(
    `
    INSERT INTO notification_jobs
      ("agencyId", type, "eventKey", "actorUserId", "entityType", "entityId", payload, status)
    VALUES
      (:agencyId, :type, :eventKey, :actorUserId, :entityType, :entityId, :payload::jsonb, 'pending')
    ON CONFLICT ("eventKey") DO NOTHING
    RETURNING id
  `,
    {
      agencyId: args.agencyId,
      type: args.type,
      eventKey: args.eventKey,
      actorUserId: args.actorUserId,
      entityType: args.entityType,
      entityId: args.entityId,
      payload: JSON.stringify(args.payload ?? {}),
    },
  )
}

/** null ⇒ the event was already enqueued (a retry). Not an error. */
export async function enqueueNotificationJob(
  q: Knex.Transaction | Knex,
  args: EnqueueNotificationJobArgs,
): Promise<number | null> {
  const res = await enqueueNotificationJobQuery(q, args)
  const row = res.rows?.[0]
  return row ? Number(row.id) : null
}

/**
 * Lease claim. `FOR UPDATE SKIP LOCKED` lets this overlap safely with itself and
 * with after() kicks — two workers never claim the same job, and neither waits
 * on the other (spec §21.2).
 */
export function claimNotificationJobsQuery(workerId: string, limit: number) {
  return db.raw(
    `
    UPDATE notification_jobs j
       SET status = 'processing', "lockedAt" = now(), "lockedBy" = ?,
           attempts = attempts + 1, "updatedAt" = now()
     WHERE j.id IN (
       SELECT id FROM notification_jobs
        WHERE status = 'pending' AND "notBefore" <= now()
        ORDER BY "notBefore" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ?
     )
     RETURNING j.id, j."agencyId", j.type, j."eventKey", j."actorUserId",
               j."entityType", j."entityId", j.payload, j.attempts,
               j."maxAttempts", j."createdAt"
  `,
    [workerId, limit],
  )
}

export async function claimNotificationJobs(workerId: string, limit: number): Promise<NotificationJob[]> {
  const res = await claimNotificationJobsQuery(workerId, limit)
  return (res.rows ?? []).map((r: Record<string, unknown>) => ({
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    type: r.type as NotificationType,
    eventKey: String(r.eventKey),
    actorUserId: r.actorUserId == null ? null : Number(r.actorUserId),
    entityType: r.entityType as EntityType,
    entityId: Number(r.entityId),
    payload: (r.payload ?? {}) as NotificationPayload,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.maxAttempts),
    createdAt: new Date(r.createdAt as string | Date).toISOString(),
  }))
}

/** A worker that died mid-job leaves a lease behind; the next pass takes it back. */
export function reclaimStaleNotificationJobsQuery(cutoff: Date) {
  return db.raw(
    `
    UPDATE notification_jobs
       SET status = 'pending', "lockedAt" = NULL, "lockedBy" = NULL,
           "lastError" = 'lease-expired-reclaimed', "updatedAt" = now()
     WHERE status = 'processing' AND "lockedAt" < ?
     RETURNING id
  `,
    [cutoff],
  )
}

export async function reclaimStaleNotificationJobs(leaseMs: number): Promise<number> {
  const res = await reclaimStaleNotificationJobsQuery(new Date(Date.now() - leaseMs))
  return res.rows?.length ?? 0
}

export async function completeNotificationJob(id: number): Promise<void> {
  await db('notification_jobs').where({ id }).update({ status: 'done', lockedAt: null, lockedBy: null, updatedAt: db.fn.now() })
}

/**
 * A recorded non-outcome: nothing was wrong, there was simply nobody to notify
 * (or the type is disabled, or the actor was the only recipient). `skipReason`
 * is why, and it is always set — no job ends silently.
 */
export async function skipNotificationJob(id: number, skipReason: string): Promise<void> {
  await db('notification_jobs')
    .where({ id })
    .update({ status: 'skipped', skipReason, lockedAt: null, lockedBy: null, updatedAt: db.fn.now() })
}

export function failNotificationJobQuery(id: number, error: string) {
  // Linear backoff, dead-letter once attempts reach maxAttempts — the automation
  // queue's proven retry curve.
  return db.raw(
    `
    UPDATE notification_jobs
       SET status = CASE WHEN attempts >= "maxAttempts" THEN 'dead' ELSE 'pending' END,
           "lastError" = ?, "lockedAt" = NULL, "lockedBy" = NULL,
           "notBefore" = now() + (LEAST(attempts, 5) * interval '30 seconds'),
           "updatedAt" = now()
     WHERE id = ?
  `,
    [error, id],
  )
}

export async function failNotificationJob(id: number, error: string): Promise<void> {
  await failNotificationJobQuery(id, error)
}

export function pruneTerminalNotificationJobsQuery(cutoff: Date) {
  // Terminal plumbing past the operational window (spec §21.3). Pruning is
  // load-bearing, not housekeeping: a 200-lead/day agency generates ~200
  // rows/user/day.
  return db.raw(
    `DELETE FROM notification_jobs
      WHERE status IN ('done','skipped','dead') AND "updatedAt" < ?`,
    [cutoff],
  )
}

export async function pruneTerminalNotificationJobs(cutoff: Date): Promise<void> {
  await pruneTerminalNotificationJobsQuery(cutoff)
}
