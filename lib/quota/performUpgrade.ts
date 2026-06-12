import type { Knex } from 'knex'
import { db } from '@/config/db'
import { PERIOD_DAYS } from './constants'
import type { BillingPeriod } from '@/lib/pricing'

export type PerformUpgradeResult = { success: true } | { error: 'not_found' }

export async function performAgencyUpgrade(
  agencyId: number,
  reason: string,
  q: Knex = db,

  period: BillingPeriod = 'monthly',
): Promise<PerformUpgradeResult> {
  const exists = await q('agencies').where({ id: agencyId }).first()
  if (!exists) return { error: 'not_found' }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + PERIOD_DAYS[period] * 24 * 60 * 60 * 1000)

  await q('agencies').where({ id: agencyId }).update({ plan: 'pro', planReason: reason })
  await q('clients').where({ agencyId, overQuota: true }).update({ overQuota: false })

  await q('subscriptions')
    .insert({
      agencyId,
      planStartedAt: now,
      expiresAt,
      cancelAtPeriodEnd: false,
      billingPeriod: period,
      createdAt: now,
      updatedAt: now,
    })
    .onConflict('agencyId')
    .merge({
      planStartedAt: now,
      expiresAt,
      cancelAtPeriodEnd: false,
      billingPeriod: period,
      updatedAt: now,
    })

  return { success: true }
}
