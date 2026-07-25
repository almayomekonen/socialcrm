import { getUser, type UserDb } from '@/db/auth'
import { getAgencyProductAccess } from '@/lib/access/productAccess'

export class AuthError extends Error {
  constructor(public reason: 'no_session' | 'suspended' | 'no_agency') {
    super(reason)
    this.name = 'AuthError'
  }
}

/**
 * Thrown by {@link requireProductAccess} when the authenticated agency does not
 * currently have product access (a CONFIRMED NEVER_STARTED / TRIAL_EXPIRED).
 * Distinct from AuthError: the caller IS authenticated — they just lack an
 * active trial/subscription. The typed reason lets the UI show the right
 * activation vs upgrade surface.
 */
export class ProductAccessError extends Error {
  constructor(public reason: 'subscription-required' | 'trial-not-started') {
    super(reason)
    this.name = 'ProductAccessError'
  }
}

export async function requireUser() {
  const user = await getUser()
  if (!user) throw new AuthError('no_session')
  if (user.suspended) throw new AuthError('suspended')
  if (!user.agencyId) throw new AuthError('no_agency')
  return user
}

/**
 * Like {@link requireUser}, but narrows `agencyId` from optional to required.
 * AI server actions need this for tenant-scoped queries and to drop the
 * `agencyId!` non-null assertions. Runtime check is the same — `requireUser`
 * already throws on missing agencyId; this helper just stops the `!` from
 * spreading.
 */
export type AuthenticatedAgencyUser = UserDb & { agencyId: number }

export async function requireAgencyUser(): Promise<AuthenticatedAgencyUser> {
  const user = await requireUser()
  if (typeof user.agencyId !== 'number') throw new AuthError('no_agency')
  return user as AuthenticatedAgencyUser
}

/**
 * Product-boundary guard: an authenticated agency user WITH active product
 * access. Authentication/identity is UNCHANGED — it delegates to
 * `requireAgencyUser` (session-derived, server-trusted agencyId). This layers
 * the canonical product-access check on top:
 *
 *   PAID / TRIAL_ACTIVE / LEGACY → returns the user
 *   NEVER_STARTED / TRIAL_EXPIRED → throws ProductAccessError (fail-open on
 *                                   DB read error, per getAgencyProductAccess)
 *
 * Use ONLY on product functionality. Do NOT use on the endpoints that must stay
 * reachable while access is denied: startTrial / activation / onboarding, auth /
 * logout, subscription & paywall reads, upgrade / payment flows, verified
 * webhooks, cron / internal endpoints, and public token flows. Those keep using
 * `requireUser` / `requireAgencyUser` (or their own token/secret auth).
 *
 * Never trust client-supplied trialStatus / plan / isPro / hasAccess / agencyId:
 * this derives access from the session identity + canonical trial state only.
 */
export async function requireProductAccess(): Promise<AuthenticatedAgencyUser> {
  const user = await requireAgencyUser()
  const { status, hasAccess } = await getAgencyProductAccess(user.agencyId)
  if (!hasAccess) {
    throw new ProductAccessError(status === 'NEVER_STARTED' ? 'trial-not-started' : 'subscription-required')
  }
  return user
}
