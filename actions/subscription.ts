'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/config/db'
import { requireAgencyUser, AuthError } from '@/lib/requireUser'
import { getAgencyProductAccess } from '@/lib/access/productAccess'

export type CancelResumeResult = { ok: true } | { error: 'unauthorized' | 'no_subscription' }

async function setCancelFlag(value: boolean): Promise<CancelResumeResult> {
  let user
  try {
    user = await requireAgencyUser()
  } catch (err) {
    if (err instanceof AuthError) return { error: 'unauthorized' }
    throw err
  }

  const rowcount = await db('subscriptions')
    .where({ agencyId: user.agencyId })
    .update({ cancelAtPeriodEnd: value, updatedAt: new Date() })

  if (rowcount === 0) return { error: 'no_subscription' }

  revalidatePath('/settings/update_payment')
  return { ok: true }
}

export async function cancelRenewal(): Promise<CancelResumeResult> {
  return setCancelFlag(true)
}

export async function resumeRenewal(): Promise<CancelResumeResult> {
  return setCancelFlag(false)
}

/**
 * "Has the server positively confirmed that this agency's subscription is
 * active RIGHT NOW?" — the only entitlement question the client is allowed to
 * ask, and the only thing the activation verifier polls.
 *
 * WHY `active` IS NOT JUST `hasAccess`.
 *
 * `getAgencyProductAccess` FAILS OPEN: a transient DB error, or a missing
 * agency row, resolves to `{ status: 'UNKNOWN', hasAccess: true }` so that
 * infrastructure trouble can never lock out a paying customer. That is exactly
 * right for guarding the product — and exactly wrong as proof of payment. A
 * database hiccup one second after checkout would otherwise let the success
 * page announce "המנוי הופעל בהצלחה" for a payment that never landed.
 *
 * So `active` requires a POSITIVE answer: access granted AND a real resolved
 * status, never the fail-open sentinel. UNKNOWN means "keep waiting", which
 * costs the customer nothing — the app itself still fails open, so they are not
 * blocked while we decline to make the claim.
 *
 * Deriving that rule HERE, once, is deliberate: the client never re-implements
 * it, and the pollGate latch can only ever be cleared by this answer.
 *
 * Returns no transaction id, amount, provider reference or billing detail — a
 * boolean and the lifecycle status the client already holds via
 * EntitlementProvider. Reuses the canonical resolver; adds no query beyond the
 * one it already performs.
 */
export type EntitlementStatusResult = {
  /** Server-confirmed active entitlement. Never true on a fail-open read. */
  active: boolean
  /** Lifecycle status for copy only (PAID / TRIAL_EXPIRED / UNKNOWN / …). */
  status: string
}

export async function getEntitlementStatus(): Promise<EntitlementStatusResult> {
  let user
  try {
    user = await requireAgencyUser()
  } catch (err) {
    // Not signed in, or no agency. Not a confirmation, and not a revocation:
    // the caller simply keeps waiting.
    if (err instanceof AuthError) return { active: false, status: 'UNAUTHENTICATED' }
    throw err
  }

  const { status, hasAccess } = await getAgencyProductAccess(user.agencyId)
  return { active: hasAccess && status !== 'UNKNOWN', status }
}
