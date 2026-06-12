import type { Knex } from 'knex'
import { db } from '@/config/db'
import { getAgencyPlan } from './index'
import type { Plan } from './types'
import type { BillingPeriod } from '@/lib/pricing'

export type SubscriptionStatus = 'active' | 'cancelling' | 'inactive'

export type SubscriptionView = {
  plan: Plan
  expiresAt: Date | null
  cancelAtPeriodEnd: boolean
  status: SubscriptionStatus
  /** Additive (annual plan): which period the customer is on. */
  billingPeriod: BillingPeriod
  /** False iff no `subscriptions` row exists for this agency (legacy / grandfathered). */
  manageable: boolean
}

/**
 * Pure status derivation. Extracted so unit tests can cover all branches
 * without a database.
 */
export function deriveStatus(plan: Plan, cancelAtPeriodEnd: boolean): SubscriptionStatus {
  if (plan !== 'pro') return 'inactive'
  return cancelAtPeriodEnd ? 'cancelling' : 'active'
}

type SubscriptionRow = { expiresAt: Date | null; cancelAtPeriodEnd: boolean; billingPeriod: string | null }

export async function getSubscriptionView(agencyId: number, q: Knex = db): Promise<SubscriptionView> {
  const plan = await getAgencyPlan(agencyId, q)
  const row = await q('subscriptions')
    .where({ agencyId })
    .select('expiresAt', 'cancelAtPeriodEnd', 'billingPeriod')
    .first<SubscriptionRow>()

  if (!row) {
    // Legacy / grandfathered: no subscription metadata exists.
    return {
      plan,
      expiresAt: null,
      cancelAtPeriodEnd: false,
      status: deriveStatus(plan, false),
      billingPeriod: 'monthly',
      manageable: false,
    }
  }

  return {
    plan,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    status: deriveStatus(plan, row.cancelAtPeriodEnd),
    billingPeriod: row.billingPeriod === 'annual' ? 'annual' : 'monthly',
    manageable: true,
  }
}
