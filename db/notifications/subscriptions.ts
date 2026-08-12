import { db } from '@/config/db'

/**
 * push_subscriptions data access — P3.1 lifecycle + P3.2 delivery reads.
 * Spec §15.3, §18.4, §20.5.
 *
 * Writers: subscribe/unsubscribe routes (session-bound).
 * Readers for delivery: always scoped to (agencyId, userId) — never endpoint
 * alone. Dead subscriptions (404/410) are deleted with the same scope.
 *
 * Security:
 *   - agencyId / userId are ALWAYS parameters from the session / worker plan,
 *     never from the browser body.
 *   - `endpoint` is globally unique. Upsert ON CONFLICT reassigns the row to the
 *     authenticated user, so a device changing hands is never dual-bound.
 *   - Delete is scoped to (agencyId, userId, endpoint|id) — another user's row
 *     deletes zero rows.
 */

export type PushSubscriptionRow = {
  id: number
  agencyId: number
  userId: number
  endpoint: string
  p256dh: string
  auth: string
}

export type PushSubscriptionWrite = {
  agencyId: number
  userId: number
  endpoint: string
  p256dh: string
  auth: string
  /** From the request User-Agent header, truncated. Never from the JSON body. */
  userAgent: string | null
}

/**
 * Create or reassign. One statement: a prior binding for the same endpoint is
 * overwritten in place (agencyId/userId/keys), which is the §15.3 reassignment
 * rule — equivalent to "delete the prior row then insert", without a window
 * where two users could share the endpoint.
 */
export function upsertPushSubscriptionQuery(args: PushSubscriptionWrite) {
  return db.raw(
    `
    INSERT INTO push_subscriptions
      ("agencyId", "userId", endpoint, "p256dh", auth, "userAgent", "createdAt", "failureCount")
    VALUES
      (:agencyId, :userId, :endpoint, :p256dh, :auth, :userAgent, now(), 0)
    ON CONFLICT (endpoint) DO UPDATE
       SET "agencyId"     = EXCLUDED."agencyId",
           "userId"       = EXCLUDED."userId",
           "p256dh"       = EXCLUDED."p256dh",
           auth           = EXCLUDED.auth,
           "userAgent"    = EXCLUDED."userAgent",
           "failureCount" = 0,
           "lastUsedAt"   = NULL
    RETURNING id, "agencyId", "userId", endpoint`,
    {
      agencyId: args.agencyId,
      userId: args.userId,
      endpoint: args.endpoint,
      p256dh: args.p256dh,
      auth: args.auth,
      userAgent: args.userAgent,
    },
  )
}

export async function upsertPushSubscription(args: PushSubscriptionWrite): Promise<{
  id: number
  agencyId: number
  userId: number
  endpoint: string
}> {
  const res = await upsertPushSubscriptionQuery(args)
  const row = (res.rows ?? [])[0]
  if (!row) throw new Error('push_subscription_upsert_empty')
  return {
    id: Number(row.id),
    agencyId: Number(row.agencyId),
    userId: Number(row.userId),
    endpoint: String(row.endpoint),
  }
}

/**
 * Session-scoped remove. Matching endpoint belonging to another user ⇒ 0 rows.
 */
export function deletePushSubscriptionQuery(args: {
  agencyId: number
  userId: number
  endpoint: string
}) {
  return db('push_subscriptions')
    .where({
      agencyId: args.agencyId,
      userId: args.userId,
      endpoint: args.endpoint,
    })
    .del()
}

export async function deletePushSubscription(args: {
  agencyId: number
  userId: number
  endpoint: string
}): Promise<number> {
  return deletePushSubscriptionQuery(args)
}

/** Count rows for a user — used only by status reporting, never for delivery. */
export function countUserPushSubscriptionsQuery(args: { agencyId: number; userId: number }) {
  return db('push_subscriptions').where({ agencyId: args.agencyId, userId: args.userId }).count({ n: '*' }).first()
}

export async function countUserPushSubscriptions(args: {
  agencyId: number
  userId: number
}): Promise<number> {
  const row = await countUserPushSubscriptionsQuery(args)
  return Number((row as { n?: string | number } | undefined)?.n ?? 0)
}

/**
 * Delivery lookup — every active device for this recipient. Scoped to BOTH
 * agencyId and userId so a stolen endpoint id cannot pull another tenant's row.
 */
export function listPushSubscriptionsForUserQuery(args: { agencyId: number; userId: number }) {
  return db('push_subscriptions')
    .where({ agencyId: args.agencyId, userId: args.userId })
    .select('id', 'agencyId', 'userId', 'endpoint', 'p256dh', 'auth')
    .orderBy('id', 'asc')
}

export async function listPushSubscriptionsForUser(args: {
  agencyId: number
  userId: number
}): Promise<PushSubscriptionRow[]> {
  const rows = await listPushSubscriptionsForUserQuery(args)
  return (rows as PushSubscriptionRow[]).map((r) => ({
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    userId: Number(r.userId),
    endpoint: String(r.endpoint),
    p256dh: String(r.p256dh),
    auth: String(r.auth),
  }))
}

/** Dead-subscription cleanup — id alone is not enough; scope is mandatory. */
export function deletePushSubscriptionByIdQuery(args: {
  id: number
  agencyId: number
  userId: number
}) {
  return db('push_subscriptions')
    .where({ id: args.id, agencyId: args.agencyId, userId: args.userId })
    .del()
}

export async function deletePushSubscriptionById(args: {
  id: number
  agencyId: number
  userId: number
}): Promise<number> {
  return deletePushSubscriptionByIdQuery(args)
}

export function touchPushSubscriptionUsedQuery(args: {
  id: number
  agencyId: number
  userId: number
}) {
  return db('push_subscriptions')
    .where({ id: args.id, agencyId: args.agencyId, userId: args.userId })
    .update({ lastUsedAt: db.fn.now() })
}

export async function touchPushSubscriptionUsed(args: {
  id: number
  agencyId: number
  userId: number
}): Promise<void> {
  await touchPushSubscriptionUsedQuery(args)
}
