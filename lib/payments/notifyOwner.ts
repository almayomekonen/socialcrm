/**
 * Tell an agency owner about a billing event, without letting mail break billing.
 *
 * `config/resend.ts` constructs the Resend client at IMPORT time and throws when
 * `RESEND` is unset. Importing the dispatcher from the charge engine or the
 * callback route therefore turns a missing email key into a billing outage:
 * every attempt would fail on module load, before any money logic ran. The
 * import is deferred to the moment a notification is actually wanted, and every
 * failure — a missing key included — is logged and swallowed.
 *
 * Callers must only reach here AFTER their database work has committed. The row
 * is the source of truth; this is an announcement about it, and an announcement
 * that does not go out must never undo what it was announcing.
 */
export type BillingLifecycleEvent = 'subscription.activated' | 'subscription.payment_failed' | 'trial.card_started'

export async function notifyAgencyOwner(event: BillingLifecycleEvent, agencyId: number, log: string): Promise<void> {
  try {
    const [{ dispatchLifecycleEvent }, { agencyOwner }] = await Promise.all([
      import('@/lib/emailAutomations/live'),
      import('@/lib/emailAutomations/recipients'),
    ])
    const owner = await agencyOwner(agencyId)
    if (!owner) {
      console.warn(`${log} ${event}: no owner resolved`, { agencyId })
      return
    }
    await dispatchLifecycleEvent(event, owner, new Date())
  } catch (err) {
    console.error(`${log} ${event} not dispatched`, { agencyId, err: String(err) })
  }
}
