import type { Knex } from 'knex'
import { db } from '@/config/db'
import { isDevBypassAgency } from '@/lib/auth/devBypass'
import { getTrialState, hasActiveProductAccess } from '@/lib/trial'
import { FREE_LEAD_LIMIT } from './constants'
import { Plan, QuotaExceededError, QuotaStatus } from './types'

export { FREE_LEAD_LIMIT } from './constants'
export { QuotaExceededError } from './types'
export type { Plan, QuotaStatus, QuotaErrorResult } from './types'
export { withAgencyQuotaLock, QUOTA_LOCK_NAMESPACE } from './withAgencyQuotaLock'

/**
 * Raw subscription plan. Reflects `agencies.plan` only (plus the dev/owner
 * bypass). This is the BILLING truth — an agency inside its 7-day trial is
 * still 'free' here, because it has not paid. Use this for billing/subscription
 * surfaces; use getEffectiveLeadPlan for access/quota decisions.
 */
export async function getAgencyPlan(agencyId: number, q: Knex = db): Promise<Plan> {
  // Developer plan bypass: returns 'pro' for the allowlisted dev/owner account
  // and no one else (see lib/auth/devBypass.ts).
  if (await isDevBypassAgency(agencyId)) return 'pro'
  const row = await q('agencies').where({ id: agencyId }).select('plan').first()
  return row?.plan === 'pro' ? 'pro' : 'free'
}

/**
 * Effective lead-access tier — the canonical chokepoint every lead quota and
 * over-quota gate reads. NOT subscription state: this returns 'pro' (full
 * access, no cap) whenever the agency currently HAS the product — a paid
 * subscription, an in-window trial, or a grandfathered (LEGACY) agency — and
 * 'free' (capped) only for expired / never-started accounts.
 *
 * Access is derived through getTrialState + hasActiveProductAccess — the single
 * trial state machine. This function maps that status onto access; it never
 * re-derives trial dates (no second state machine). Billing questions must use
 * getAgencyPlan / getSubscriptionView, never this.
 */
export async function getEffectiveLeadPlan(agencyId: number, q: Knex = db): Promise<Plan> {
  if (await isDevBypassAgency(agencyId)) return 'pro'
  // Model B: LEFT JOIN the subscription so getTrialState resolves PAID from an
  // ACTIVE prepaid period (planReason + expiresAt), not agencies.plan alone.
  const row = await q('agencies')
    .leftJoin('subscriptions', 'subscriptions.agencyId', 'agencies.id')
    .where('agencies.id', agencyId)
    .select(
      'agencies.plan',
      'agencies.trialExempt',
      'agencies.trialStartedAt',
      'agencies.trialEndsAt',
      'agencies.planReason',
      'subscriptions.expiresAt',
    )
    .first()
  if (!row) return 'free'
  const status = getTrialState(row, new Date()).status
  return hasActiveProductAccess(status) ? 'pro' : 'free'
}

async function countVisibleLeads(agencyId: number, q: Knex = db): Promise<number> {
  const row = await q('clients').where({ agencyId, overQuota: false, lead: true }).count<{ count: string }>('id as count').first()
  return Number(row?.count ?? 0)
}

export async function assertLeadQuota(agencyId: number, incoming = 1, q: Knex = db): Promise<void> {
  // Effective access, not subscription: a trial/legacy agency is uncapped here
  // even though its plan is still 'free'.
  const plan = await getEffectiveLeadPlan(agencyId, q)
  if (plan === 'pro') return

  const current = await countVisibleLeads(agencyId, q)
  if (current + incoming > FREE_LEAD_LIMIT) {
    throw new QuotaExceededError(current, FREE_LEAD_LIMIT, incoming)
  }
}

export async function getQuotaStatus(agencyId: number): Promise<QuotaStatus> {
  const [plan, visibleRow, overRow] = await Promise.all([
    getEffectiveLeadPlan(agencyId),
    db('clients').where({ agencyId, overQuota: false, lead: true }).count<{ count: string }>('id as count').first(),
    db('clients').where({ agencyId, overQuota: true, lead: true }).count<{ count: string }>('id as count').first(),
  ])

  const used = Number(visibleRow?.count ?? 0)
  const overQuotaCount = Number(overRow?.count ?? 0)

  if (plan === 'pro') {
    // Pro has no quota ceiling — nothing is withheld, so the "upgrade to view"
    // banner must never show. Genuine Pro agencies already carry zero overQuota
    // rows, so forcing 0 is a no-op for them.
    return { plan, used, limit: null, remaining: null, overQuotaCount: 0 }
  }

  return {
    plan,
    used,
    limit: FREE_LEAD_LIMIT,
    remaining: Math.max(0, FREE_LEAD_LIMIT - used),
    overQuotaCount,
  }
}
