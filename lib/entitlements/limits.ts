import type { Plan } from '@/lib/quota'
import type { AiModeId } from './types'

/**
 * Single source of truth for AI quota numbers.
 *
 * One file so the product owner can tune limits without grepping the
 * codebase. Anything that needs to know "how many fast actions does Free
 * get" goes through here, never a literal in another module.
 *
 * Convention:
 *   - `number` — capped to this many successful AI runs per calendar month.
 *   - `null`   — uncapped (Pro across all modes today).
 *   - `0`      — mode is not available on this plan at all. Renders as a
 *                tier-gated affordance; never decremented.
 *
 * The matrix below intentionally mirrors the pricing page copy:
 *   Free → 10 fast/month, smart and advanced locked behind Pro.
 *   Pro  → uncapped across all three modes.
 *
 * The monthly window is `date_trunc('month', now())` in UTC. Aggregation
 * lives in `aiUsage.ts`; this file holds numbers only.
 */

const FREE_LIMITS: Record<AiModeId, number | null> = {
  fast: 10,
  smart: 0,
  advanced: 0,
}

const PRO_LIMITS: Record<AiModeId, number | null> = {
  fast: null,
  smart: null,
  advanced: null,
}

/** Monthly limit for (plan, mode). Negative numbers are never returned. */
export function getMonthlyLimit(plan: Plan, mode: AiModeId): number | null {
  return plan === 'pro' ? PRO_LIMITS[mode] : FREE_LIMITS[mode]
}

/** Does this plan have any access to this mode at all? */
export function isModeAvailableOnPlan(plan: Plan, mode: AiModeId): boolean {
  const limit = getMonthlyLimit(plan, mode)
  return limit === null || limit > 0
}
