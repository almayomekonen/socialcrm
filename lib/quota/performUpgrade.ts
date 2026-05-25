import type { Knex } from 'knex'
import { db } from '@/config/db'
import { SUBSCRIPTION_PERIOD_DAYS } from './constants'

export type PerformUpgradeResult = { success: true } | { error: 'not_found' }

export async function performAgencyUpgrade(
  agencyId: number,
  reason: string,
  q: Knex = db,
): Promise<PerformUpgradeResult> {
  const exists = await q('agencies').where({ id: agencyId }).first()
  if (!exists) return { error: 'not_found' }

  // Single `now` captured for transactional consistency across all timestamps.
  // `new Date()` represents an absolute UTC instant; `timestamptz` stores it
  // as UTC. Do not introduce ISO-string round-trips or local-time math here.
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60 * 1000)

  await q('agencies').where({ id: agencyId }).update({ plan: 'pro', planReason: reason })
  await q('clients').where({ agencyId, overQuota: true }).update({ overQuota: false })

  // Upsert subscriptions row. createdAt is intentionally NOT in the merge —
  // it retains the original first-purchase timestamp across renewals.
  //
  // Webhook idempotency: this call lives inside the same db.transaction(...)
  // as the payments-table insert in the webhook handler. A duplicate
  // transactionId raises 23505 on the payments insert and rolls back this
  // upsert too, so expiresAt is never extended by a duplicate delivery.
  await q('subscriptions')
    .insert({
      agencyId,
      planStartedAt: now,
      expiresAt,
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflict('agencyId')
    .merge({
      planStartedAt: now,
      expiresAt,
      cancelAtPeriodEnd: false,
      updatedAt: now,
    })

  return { success: true }
}
