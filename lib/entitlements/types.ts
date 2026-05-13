import type { Plan } from '@/lib/quota'
import type { CopilotModeId } from '@/lib/ai/copilotModes'

/**
 * Entitlement contracts.
 *
 * "Entitlement" answers: *what is this workspace allowed to do, right now?*
 * It composes two underlying truths:
 *   1. The billing plan (`free` | `pro`) — read from `agencies.plan` via
 *      `lib/quota/getAgencyPlan`. lib/entitlements does not own this; it wraps
 *      it. Payment and quota stay in their own folders.
 *   2. Current monthly AI consumption — aggregated from `ai_runs`.
 *
 * The output of `getEntitlements(agencyId)` is a self-contained snapshot the
 * rest of the app can read without touching either source itself. Nothing in
 * Phase A consumes this snapshot — it exists so later phases (server-action
 * gates, hydrated UI, upgrade modal) have one canonical truth to read from.
 *
 * Doctrine reminders that bake into the type shape:
 *   - The snapshot never contains provider names, model IDs, or any execution
 *     metadata. Those live on `ai_runs` and are aggregated out here. The UI
 *     reads counts, not what produced them.
 *   - The snapshot is read-only. There is no `setX` here — to change the plan
 *     you go through `lib/quota/performUpgrade`.
 *   - The snapshot is request-scoped. It is fresh per request, not per render.
 */

export type { Plan } from '@/lib/quota'

/**
 * Why this workspace has the plan it has. Useful for analytics, the
 * inspector, and (later) for surfacing the right upgrade copy. Never used
 * for access decisions — those go off `plan` alone.
 *
 *   - 'payment'     — paid via Grow, planReason starts with 'grow:'
 *   - 'admin-grant' — manual upgrade by an admin (planReason='manual' etc.)
 *   - 'allowlist'   — workspace is in AI_AGENCY_ALLOWLIST. Free plan; the
 *                     allowlist is a separate legacy gate that will be retired
 *                     in Phase C. Recorded here so we can audit overlap.
 *   - null          — free plan, no historical reason worth surfacing
 */
export type PlanSource = 'payment' | 'admin-grant' | 'allowlist' | null

/** Mirrors `CopilotModeId` for clarity at call sites. */
export type AiModeId = CopilotModeId

/**
 * Per-mode quota window. `limit: null` means uncapped on this plan (Pro
 * across all modes today). `used` and `remaining` are monthly counters
 * keyed off `date_trunc('month', now())`.
 */
export type AiModeQuota = {
  used: number
  limit: number | null
  remaining: number | null
}

/** AI-shaped slice of entitlements — what the Copilot surface cares about. */
export type AiAccess = {
  /** Per-mode access. A mode the plan cannot use at all has `allowed: false`. */
  modes: Record<AiModeId, { allowed: boolean; quota: AiModeQuota }>
  /** Sum of all successful AI runs this month, across modes. */
  totalUsedThisMonth: number
  /** Month bucket the counters describe (ISO date of month start, UTC). */
  windowStart: string
}

/**
 * Top-level entitlement snapshot. One per (agencyId, request).
 */
export type Entitlements = {
  agencyId: number
  plan: Plan
  planSource: PlanSource
  ai: AiAccess
}
