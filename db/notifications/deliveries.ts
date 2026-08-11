import type { Knex } from 'knex'
import { db } from '@/config/db'
import type { Channel } from '@/lib/notifications/types'

/**
 * notification_deliveries data access — one row per channel attempt. Spec §18.3.
 *
 * P1 writes IN_APP rows only. The other three channels arrive in P3 against this
 * same shape, which is why `channel` is a parameter rather than a hardcoded
 * literal.
 */

/**
 * Record the in-app delivery.
 *
 * Status is `sent`, never `delivered`. The distinction is a data-honesty rule
 * (spec §18.3): `delivered` is only ever written where the channel genuinely
 * reports it, which today means email via Resend events. In-app and push know
 * that a row was written, not that a human saw it — and the row that records
 * being seen is `notifications.seenAt`, set only when SocialCRM actually renders
 * it (spec §8.2).
 *
 * Takes a query builder so a caller can record the delivery inside the same
 * transaction that created the notification.
 */
export function recordDeliveryQuery(
  q: Knex.Transaction | Knex,
  args: { notificationId: number; agencyId: number; userId: number; channel: Channel },
) {
  return q.raw(
    `
    INSERT INTO notification_deliveries
      ("notificationId","agencyId","userId",channel,status,attempts,"sentAt")
    VALUES (:notificationId,:agencyId,:userId,:channel,'sent',1,now())
    RETURNING id
  `,
    args,
  )
}

export async function recordDelivery(
  q: Knex.Transaction | Knex,
  args: { notificationId: number; agencyId: number; userId: number; channel: Channel },
): Promise<number | null> {
  const res = await recordDeliveryQuery(q, args)
  const row = res.rows?.[0]
  return row ? Number(row.id) : null
}

/**
 * Deliveries are pruned by cascade, not by a query of their own:
 * `notification_deliveries."notificationId"` is ON DELETE CASCADE, so pruning
 * notifications (spec §21.3) takes their delivery rows with them. A separate
 * sweep here could only ever orphan or double-delete.
 *
 * Terminal delivery rows for notifications that are still live are deliberately
 * kept — they are the answer to "why didn't I get a push?" (spec §11).
 */
export async function countDeliveriesForNotification(args: {
  notificationId: number
  agencyId: number
  userId: number
}): Promise<number> {
  const row = await db('notification_deliveries')
    .where({ notificationId: args.notificationId, agencyId: args.agencyId, userId: args.userId })
    .count<{ count: string }[]>('id as count')
    .first()
  return Number(row?.count ?? 0)
}
