import { getAgencyProductAccess } from '@/lib/access/productAccess'

/**
 * AI product-access authorization decision. Effective product access, NOT
 * subscription plan: PAID, TRIAL_ACTIVE and LEGACY all resolve to `allowed`,
 * exactly as the lead-quota layer does (Phase 1's hasActiveProductAccess). Only
 * a CONFIRMED expired or not-yet-started trial denies, with a distinct typed
 * reason so the client can show the right message.
 *
 * PRODUCTION-SAFETY — this FAILS OPEN. A transient DB/read failure, or a missing
 * agency row, must never tell a paying customer "subscription required". Only an
 * agency row that we successfully read AND that classifies as TRIAL_EXPIRED /
 * NEVER_STARTED is denied. Everything else — including UNKNOWN/error — is
 * allowed, mirroring the layout gate (`app/(app)/layout.tsx`), which defaults to
 * LEGACY and logs "failing open" on read error. The global safety controls
 * (AI_ENABLED, allowlist, provider config, daily USD cap) live in the router and
 * are unaffected by this decision.
 */
export type AiAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: 'subscription-required' | 'trial-not-started' }

export async function resolveAiAccess(agencyId: number): Promise<AiAccessDecision> {
  // Shares the single canonical resolver (cached per request, fail-open on
  // read error). Behavior is unchanged from the previous inline read.
  const { status, hasAccess } = await getAgencyProductAccess(agencyId)
  if (hasAccess) return { allowed: true }
  if (status === 'NEVER_STARTED') return { allowed: false, reason: 'trial-not-started' }
  // The only remaining blocked status is TRIAL_EXPIRED.
  return { allowed: false, reason: 'subscription-required' }
}
