import { db } from '@/config/db'
import { isAgencyAllowlisted } from '@/lib/ai/flags'
import { isDevBypassAgency } from '@/lib/auth/devBypass'
import { isPaidPeriodActive } from '@/lib/trial'
import type { Plan, PlanSource } from './types'

/**
 * Plan-source inference.
 *
 * `agencies.plan` answers *what* the plan is. This file answers *why*. The
 * "why" comes from a free-text `agencies.planReason` column that historical
 * upgrade paths populate:
 *
 *   - `grow:<transactionId>` — written by the Grow webhook → 'payment'
 *   - 'manual' or anything else — written by an admin action → 'admin-grant'
 *
 * For free workspaces, we additionally check the legacy allowlist
 * (`AI_AGENCY_ALLOWLIST` env var via `isAgencyAllowlisted`). That allowlist
 * is the pre-monetization gate currently used by `lib/ai/router`. Phase C of
 * the entitlement rollout will replace that check; until then we record
 * allowlist status so the inspector and analytics can audit overlap with the
 * paid base.
 */

type AgencyPlanRow = { plan: string | null; planReason: string | null; expiresAt: Date | string | null }

export async function readAgencyPlanRow(agencyId: number): Promise<AgencyPlanRow | null> {
  // Model B: LEFT JOIN the subscription period so the AI entitlement gate can
  // require an ACTIVE paid period, not just agencies.plan='pro'.
  const row = await db('agencies')
    .leftJoin('subscriptions', 'subscriptions.agencyId', 'agencies.id')
    .where('agencies.id', agencyId)
    .select('agencies.plan', 'agencies.planReason', 'subscriptions.expiresAt')
    .first<AgencyPlanRow>()
  return row ?? null
}

/**
 * Pure derivation given the agency row + resolved plan. Pulled out so unit
 * tests can poke edge cases (null planReason, unexpected free + grow:* pair)
 * without going through the DB.
 */
export function derivePlanSource(plan: Plan, planReason: string | null, allowlisted: boolean): PlanSource {
  if (plan === 'pro') {
    if (planReason && planReason.startsWith('grow:')) return 'payment'
    return 'admin-grant'
  }
  if (allowlisted) return 'allowlist'
  return null
}

/**
 * Compose the row read + derivation. The aggregator in `getEntitlements`
 * calls this; outside callers should not — they want the full snapshot.
 */
export async function resolvePlanAndSource(agencyId: number): Promise<{ plan: Plan; planSource: PlanSource }> {
  const row = await readAgencyPlanRow(agencyId)
  // Developer plan bypass: allowlisted dev/owner account resolves as Pro
  // without touching stored subscription (see lib/auth/devBypass.ts).
  const bypass = await isDevBypassAgency(agencyId)
  // Model B: agencies.plan='pro' is NOT sufficient — a grow prepaid period must
  // be ACTIVE (isPaidPeriodActive). Dev bypass and explicit admin grants still
  // resolve to Pro; trial users are unchanged (plan='free' → free AI, exactly as
  // before). Reuses the ONE canonical predicate — no duplicated date logic.
  const paidActive =
    bypass ||
    isPaidPeriodActive(
      { plan: row?.plan === 'pro' ? 'pro' : 'free', planReason: row?.planReason ?? null, expiresAt: row?.expiresAt ?? null },
      new Date(),
    )
  const plan: Plan = paidActive ? 'pro' : 'free'
  const allowlisted = isAgencyAllowlisted(agencyId)
  const planSource = derivePlanSource(plan, row?.planReason ?? null, allowlisted)
  return { plan, planSource }
}
