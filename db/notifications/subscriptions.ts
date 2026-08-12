import { db } from '@/config/db'

/**
 * push_subscriptions data access — P3.1 lifecycle only. Spec §15.3, §18.4, §20.5.
 *
 * NO delivery lives here. Rows are created and removed so a later push channel can
 * find them; nothing in this module (or in P3.1) calls web-push or records a
 * notification_deliveries row for push.
 *
 * Security:
 *   - agencyId / userId are ALWAYS parameters from the session, never from the
 *     browser body.
 *   - `endpoint` is globally unique. Upsert ON CONFLICT reassigns the row to the
 *     authenticated user, so a device changing hands is never dual-bound.
 *   - Delete is scoped to (agencyId, userId, endpoint) — another user's endpoint
 *     deletes zero rows.
 */

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
