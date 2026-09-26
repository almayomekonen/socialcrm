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
  /** False iff there is no recurring subscription to manage (legacy / grandfathered / admin grant). */
  manageable: boolean
  /**
   * WHERE Pro actually comes from.
   *
   *   'grant'        — agencies.plan='pro' with a non-'grow:' planReason: an
   *                    explicit admin grant with no prepaid period.
   *   'subscription' — a real recurring subscription row governs access.
   *   'none'         — not Pro, or Pro with no subscription metadata at all.
   */
  source: 'grant' | 'subscription' | 'none'
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

/**
 * An admin grant is not a subscription, and the two must not be mixed.
 *
 * Agency 103 is the case that proved it: plan 'pro' / planReason
 * 'manual:owner-comp', beside a `subscriptions` row left over from the Payment
 * Links era — cancelAtPeriodEnd true, expiresAt 2026-09-22, a growDirectDebitId.
 * That row is HISTORY. Reading it as current state told the owner, on one
 * screen, that a cancellation request was received, that they were on ₪89 a
 * month, and that access ended four days ago — while isPaidPeriodActive was
 * (correctly) granting them unlimited Pro the whole time.
 *
 * The discriminator is the same 'grow:' prefix isPaidPeriodActive and
 * derivePlanSource use, so entitlement and its presentation cannot disagree.
 * The row itself is never touched: billing history stays exactly as it is, it
 * simply stops being mistaken for the present.
 */
function isAdminGrant(plan: Plan, planReason: string | null): boolean {
  const reason = (planReason ?? '').trim()
  // An EXPLICIT non-grow reason only. isPaidPeriodActive treats a null reason as
  // non-prepaid too, but that is a question about access, and erring towards
  // granting it is safe. This is a question about what the screen SAYS, and a
  // legacy 'pro' agency with no recorded reason may well have a real recurring
  // subscription — calling that a grant would strip its plan management.
  return plan === 'pro' && reason !== '' && !reason.startsWith('grow:')
}

export async function getSubscriptionView(agencyId: number, q: Knex = db): Promise<SubscriptionView> {
  const plan = await getAgencyPlan(agencyId, q)
  const agency = await q('agencies').where({ id: agencyId }).select('planReason').first<{ planReason: string | null }>()

  if (isAdminGrant(plan, agency?.planReason ?? null)) {
    // No prepaid period, no renewal, and nothing to cancel.
    return {
      plan,
      expiresAt: null,
      cancelAtPeriodEnd: false,
      status: 'active',
      billingPeriod: 'monthly',
      manageable: false,
      source: 'grant',
    }
  }

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
      source: 'none',
    }
  }

  return {
    plan,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    status: deriveStatus(plan, row.cancelAtPeriodEnd),
    billingPeriod: row.billingPeriod === 'annual' ? 'annual' : 'monthly',
    manageable: true,
    source: 'subscription',
  }
}
