import type { Knex } from 'knex'
import { db } from '@/config/db'
import type { Channel } from '@/lib/notifications/types'

/**
 * notification_deliveries data access — one row per channel attempt. Spec §18.3.
 *
 * P1 wrote IN_APP as `sent` immediately. P3.2 adds WEB_PUSH with pending →
 * sent | failed | suppressed. There is no unique index on (notificationId,
 * channel) in the schema; uniqueness is enforced at write time via
 * `ensureChannelDelivery` so retries cannot insert a second row or re-send
 * a terminal attempt.
 */

export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'suppressed'

export type DeliveryRow = {
  id: number
  notificationId: number
  agencyId: number
  userId: number
  channel: Channel
  status: DeliveryStatus
  attempts: number
}

/**
 * Record an in-app (or already-final) delivery as `sent`.
 *
 * Status is `sent`, never `delivered`. The distinction is a data-honesty rule
 * (spec §18.3): `delivered` is only ever written where the channel genuinely
 * reports it, which today means email via Resend events. In-app and push know
 * that a row was written / the push service accepted it, not that a human saw
 * it — and the row that records being seen is `notifications.seenAt`.
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

export function findChannelDeliveryQuery(
  q: Knex.Transaction | Knex,
  args: { notificationId: number; agencyId: number; userId: number; channel: Channel },
) {
  return q('notification_deliveries')
    .where({
      notificationId: args.notificationId,
      agencyId: args.agencyId,
      userId: args.userId,
      channel: args.channel,
    })
    .first('id', 'notificationId', 'agencyId', 'userId', 'channel', 'status', 'attempts')
}

export async function findChannelDelivery(
  q: Knex.Transaction | Knex,
  args: { notificationId: number; agencyId: number; userId: number; channel: Channel },
): Promise<DeliveryRow | null> {
  const row = await findChannelDeliveryQuery(q, args)
  if (!row) return null
  return {
    id: Number(row.id),
    notificationId: Number(row.notificationId),
    agencyId: Number(row.agencyId),
    userId: Number(row.userId),
    channel: row.channel as Channel,
    status: row.status as DeliveryStatus,
    attempts: Number(row.attempts),
  }
}

/**
 * Insert a pending channel row if none exists. Returns the existing or new row.
 * Does not overwrite terminal statuses — that is what stops duplicate sends.
 */
export async function ensurePendingChannelDelivery(
  q: Knex.Transaction | Knex,
  args: { notificationId: number; agencyId: number; userId: number; channel: Channel },
): Promise<DeliveryRow> {
  const existing = await findChannelDelivery(q, args)
  if (existing) return existing

  const res = await q.raw(
    `
    INSERT INTO notification_deliveries
      ("notificationId","agencyId","userId",channel,status,attempts)
    VALUES (:notificationId,:agencyId,:userId,:channel,'pending',0)
    RETURNING id, "notificationId", "agencyId", "userId", channel, status, attempts
  `,
    args,
  )
  const row = res.rows?.[0]
  if (!row) {
    // Race: another worker inserted first — re-read.
    const again = await findChannelDelivery(q, args)
    if (again) return again
    throw new Error('delivery_insert_empty')
  }
  return {
    id: Number(row.id),
    notificationId: Number(row.notificationId),
    agencyId: Number(row.agencyId),
    userId: Number(row.userId),
    channel: row.channel as Channel,
    status: row.status as DeliveryStatus,
    attempts: Number(row.attempts),
  }
}

export function markDeliverySentQuery(
  q: Knex.Transaction | Knex,
  args: { id: number; agencyId: number; userId: number },
) {
  return q('notification_deliveries')
    .where({ id: args.id, agencyId: args.agencyId, userId: args.userId })
    .whereIn('status', ['pending', 'failed'])
    .update({
      status: 'sent',
      attempts: q.raw('attempts + 1'),
      sentAt: q.fn.now(),
      failureReason: null,
      failedAt: null,
    })
}

export function markDeliveryFailedQuery(
  q: Knex.Transaction | Knex,
  args: { id: number; agencyId: number; userId: number; reason: string },
) {
  return q('notification_deliveries')
    .where({ id: args.id, agencyId: args.agencyId, userId: args.userId })
    .whereIn('status', ['pending', 'failed'])
    .update({
      status: 'failed',
      attempts: q.raw('attempts + 1'),
      failureReason: args.reason.slice(0, 500),
      failedAt: q.fn.now(),
    })
}

export function markDeliverySuppressedQuery(
  q: Knex.Transaction | Knex,
  args: { id: number; agencyId: number; userId: number; reason: string },
) {
  return q('notification_deliveries')
    .where({ id: args.id, agencyId: args.agencyId, userId: args.userId })
    .whereIn('status', ['pending', 'failed'])
    .update({
      status: 'suppressed',
      attempts: q.raw('attempts + 1'),
      suppressionReason: args.reason.slice(0, 200),
      failureReason: null,
    })
}

export async function markDeliverySent(
  q: Knex.Transaction | Knex,
  args: { id: number; agencyId: number; userId: number },
): Promise<number> {
  return markDeliverySentQuery(q, args)
}

export async function markDeliveryFailed(
  q: Knex.Transaction | Knex,
  args: { id: number; agencyId: number; userId: number; reason: string },
): Promise<number> {
  return markDeliveryFailedQuery(q, args)
}

export async function markDeliverySuppressed(
  q: Knex.Transaction | Knex,
  args: { id: number; agencyId: number; userId: number; reason: string },
): Promise<number> {
  return markDeliverySuppressedQuery(q, args)
}

/**
 * Deliveries are pruned by cascade, not by a query of their own:
 * `notification_deliveries."notificationId"` is ON DELETE CASCADE, so pruning
 * notifications (spec §21.3) takes their delivery rows with them.
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
