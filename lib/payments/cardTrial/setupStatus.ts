import { getLatestPaymentMethod } from '@/db/payments/paymentMethods'
import { getAgencyTrial } from '@/db/trial'
import { firstChargeAt } from './firstCharge'

/**
 * The only card-setup facts the return page may show. Derived from OUR rows,
 * which only a VERIFIED Grow callback can move out of `pending` — never from the
 * success URL the browser landed on. A callback that arrived but could not be
 * verified stays `verifying`: "we received it, we have not confirmed it".
 */
export type CardSetupState = {
  state: 'verifying' | 'confirmed' | 'failed'
  /** True once Grow called us back, even though verification has not completed. */
  callbackReceived: boolean
  /** From the persisted trial end — present once the trial is actually running. */
  firstChargeAt: string | null
}

export async function getCardSetupStateForAgency(agencyId: number): Promise<CardSetupState> {
  const latest = await getLatestPaymentMethod(agencyId)
  const state: CardSetupState['state'] =
    !latest || latest.status === 'pending'
      ? 'verifying'
      : latest.status === 'active' || latest.status === 'replaced'
        ? 'confirmed'
        : 'failed'
  const trial = state === 'confirmed' ? await getAgencyTrial(agencyId) : null
  return {
    state,
    callbackReceived: Boolean(latest?.lastCallbackAt),
    firstChargeAt: firstChargeAt(trial?.trialEndsAt)?.toISOString() ?? null,
  }
}
