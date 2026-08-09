import { db } from '@/config/db'
import { getEntitlements } from '@/lib/entitlements/getEntitlements'
import { getMonthlyLimit } from '@/lib/entitlements/limits'
import { startOfMonthUtc } from '@/lib/entitlements/aiUsage'
import { COPILOT_MODES } from '@/lib/ai/copilotModes'
import { isAutomationsAgencyAllowlisted, isAutomationsEnabled } from '@/lib/automations/flags'
import { FREE_LEAD_LIMIT } from './constants'
import type { Plan } from './types'

/**
 * What the subscriber actually got out of the plan this month — the read
 * behind the billing centre's "השימוש במסלול שלכם" section.
 *
 * Every number here is counted, never estimated: leads and AI runs from their
 * own tables, automations from automation_definitions. There is no derived or
 * illustrative figure in this file, because the section sits on a billing page
 * a paying customer is entitled to trust.
 *
 * `limit: null` means the plan genuinely has no ceiling for that metric (Pro,
 * across the board — see lib/entitlements/limits). It is NOT a placeholder for
 * "we didn't look it up": the caller renders a progress bar only when a real
 * limit exists, so an uncapped metric shows its count and no bar rather than a
 * fill against an invented denominator.
 *
 * The window is the UTC calendar month shared with lib/entitlements/aiUsage,
 * so every "this month" figure on the page describes the same period.
 */

export type UsageMetric = {
  /** Real count for the current window. */
  used: number
  /** Real ceiling, or null when the plan is uncapped for this metric. */
  limit: number | null
}

export type PlanUsage = {
  leads: UsageMetric
  ai: UsageMetric
  /**
   * null when the automation engine is not switched on for this agency — an
   * automations counter would then describe a capability the customer cannot
   * reach, which is exactly the meaningless metric CLAUDE.md §11 forbids.
   */
  automations: (UsageMetric & { created: number }) | null
}

/**
 * Total monthly AI allowance across modes. Uncapped (null) if ANY mode is
 * uncapped — one unlimited mode makes a combined ceiling meaningless.
 * Free sums to 10 (fast 10 + smart 0 + advanced 0), matching the pricing copy.
 */
function totalAiLimit(plan: Plan): number | null {
  let total = 0
  for (const mode of COPILOT_MODES) {
    const limit = getMonthlyLimit(plan, mode.id)
    if (limit === null) return null
    total += limit
  }
  return total
}

async function countLeadsThisMonth(agencyId: number, since: Date): Promise<number> {
  // Mirrors countVisibleLeads' filters (./index) so this number matches the
  // leads the customer can actually see in the CRM.
  const row = await db('clients')
    .where({ agencyId, overQuota: false, lead: true })
    .andWhere('createdAt', '>=', since)
    .count<{ count: string }>('id as count')
    .first()
  return Number(row?.count ?? 0)
}

async function countAutomations(agencyId: number): Promise<{ active: number; created: number }> {
  const rows = await db('automation_definitions')
    .where({ agencyId })
    .whereNot('status', 'deleted')
    .groupBy('status')
    .select<Array<{ status: string; count: string }>>('status')
    .count('id as count')

  let active = 0
  let created = 0
  for (const row of rows) {
    const n = Number(row.count) || 0
    created += n
    if (row.status === 'active') active += n
  }
  return { active, created }
}

export async function getPlanUsage(agencyId: number, plan: Plan): Promise<PlanUsage> {
  const since = startOfMonthUtc()
  const automationsAvailable = isAutomationsEnabled() && isAutomationsAgencyAllowlisted(agencyId)

  const [leadsUsed, entitlements, automations] = await Promise.all([
    countLeadsThisMonth(agencyId, since),
    getEntitlements(agencyId),
    automationsAvailable ? countAutomations(agencyId) : Promise.resolve(null),
  ])

  return {
    leads: { used: leadsUsed, limit: plan === 'pro' ? null : FREE_LEAD_LIMIT },
    ai: { used: entitlements.ai.totalUsedThisMonth, limit: totalAiLimit(plan) },
    // Automations carry no plan ceiling today; `created` is a real second
    // figure (how many exist), not a substitute denominator.
    automations: automations ? { used: automations.active, limit: null, created: automations.created } : null,
  }
}
