import { db } from '@/config/db'

/**
 * Onboarding completion — the ONLY thing the activation gate depends on.
 * Deliberately never queries facebook_pages or any integration table, so the
 * gate stays decoupled from FB/WhatsApp/Instagram/imports forever.
 */

/**
 * Has this agency finished onboarding?
 *
 * Fails OPEN: if the read errors (transient DB issue, or the column not yet
 * present in this environment), treat the agency as onboarded so the gate can
 * never lock anyone out of their workspace.
 */
export async function isOnboarded(agencyId: number): Promise<boolean> {
  if (!agencyId) return true
  try {
    const row = await db('agencies').select('onboardingCompletedAt').where({ id: agencyId }).first()
    return !!row?.onboardingCompletedAt
  } catch (err) {
    console.error('[onboarding] read failed; failing open (not gating)', { agencyId, err: String(err) })
    return true
  }
}

/**
 * Mark onboarding complete — idempotent and atomic. The `whereNull` guard means
 * only the first call transitions NULL → now(); repeated callbacks/refreshes are
 * no-ops. Returns true exactly once (when it actually transitions), so callers
 * can fire completion analytics at most once.
 */
export async function completeOnboarding(agencyId: number): Promise<boolean> {
  if (!agencyId) return false
  const updated = await db('agencies')
    .where({ id: agencyId })
    .whereNull('onboardingCompletedAt')
    .update({ onboardingCompletedAt: db.fn.now() })
  return updated > 0
}
