import { getAgencyTrial } from '@/db/trial'
import { getTrialState, hasActiveProductAccess } from '@/lib/trial'

/**
 * Product access for SENDING owner reminders: PAID, TRIAL_ACTIVE or LEGACY.
 *
 * Same state machine as the canonical lib/access/productAccess.ts
 * (getAgencyTrial → getTrialState → hasActiveProductAccess), with one
 * deliberate difference: it FAILS CLOSED. The canonical resolver fails open so
 * a paying customer's page never breaks on a DB hiccup; a reminder sent to an
 * agency without access cannot be taken back, so a missing row or a read error
 * means "no".
 */
export async function hasReminderProductAccess(agencyId: number, now: Date = new Date()): Promise<boolean> {
  try {
    const row = await getAgencyTrial(agencyId)
    if (!row) return false
    return hasActiveProductAccess(getTrialState(row, now).status)
  } catch (err) {
    console.error('[OwnerWaReminder][access] product-access read failed; failing closed', { agencyId, name: (err as Error)?.name ?? null })
    return false
  }
}

/** The agencies among `agencyIds` that have product access right now (one read each). */
export async function agenciesWithReminderAccess(agencyIds: number[], now: Date = new Date()): Promise<Set<number>> {
  const allowed = new Set<number>()
  for (const id of new Set(agencyIds)) if (await hasReminderProductAccess(id, now)) allowed.add(id)
  return allowed
}
