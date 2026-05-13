import type { AiModeId, Entitlements } from './types'

/**
 * Read-only predicate helpers over an `Entitlements` snapshot.
 *
 * These exist so call sites don't reach into the snapshot's internal shape.
 * If the contract changes (e.g. quota becomes per-week, or "allowed" gains a
 * grace state), only this file moves.
 *
 * Phase A wires *nothing* up to these. They are part of the read API that
 * later phases (L2 server-action gates, L1 UI hydration) will call.
 */

export function isPro(e: Entitlements): boolean {
  return e.plan === 'pro'
}

/**
 * Can this workspace run this mode *right now*? Combines two checks:
 *   - tier gate: the plan must permit the mode at all
 *   - quota gate: if capped, remaining must be > 0
 *
 * Uncapped modes (limit === null on Pro) always return true when allowed.
 */
export function canUseAiMode(e: Entitlements, mode: AiModeId): boolean {
  const access = e.ai.modes[mode]
  if (!access || !access.allowed) return false
  const { limit, remaining } = access.quota
  if (limit === null) return true
  return (remaining ?? 0) > 0
}

/**
 * Used / limit, clamped to [0, 1]. Returns 0 for uncapped modes — there is
 * no meaningful "utilization" when the ceiling is infinite, and callers that
 * render bars or warnings can treat 0 as "nothing to show."
 *
 * For locked modes (limit === 0) we return 1, so a UI bar reads "full" —
 * the user has consumed all of their (zero) allowance, which is the honest
 * framing for an upgrade nudge.
 */
export function utilizationRatio(e: Entitlements, mode: AiModeId): number {
  const access = e.ai.modes[mode]
  if (!access) return 0
  const { used, limit } = access.quota
  if (limit === null) return 0
  if (limit === 0) return 1
  const ratio = used / limit
  if (ratio < 0) return 0
  if (ratio > 1) return 1
  return ratio
}
