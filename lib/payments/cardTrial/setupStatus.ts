import { getLatestPaymentMethod } from '@/db/payments/paymentMethods'

/**
 * The only card-setup fact the success page may show. Derived from OUR row,
 * which only a VERIFIED Grow callback can move out of `pending` — never from the
 * success URL the browser landed on. A callback that arrived but could not be
 * verified leaves the state at `verifying`.
 */
export type CardSetupState = {
  state: 'verifying' | 'confirmed' | 'failed'
  reason: 'not_confirmed' | null
}

export async function getCardSetupStateForAgency(agencyId: number): Promise<CardSetupState> {
  const latest = await getLatestPaymentMethod(agencyId)
  if (!latest || latest.status === 'pending') return { state: 'verifying', reason: null }
  if (latest.status === 'active' || latest.status === 'replaced') return { state: 'confirmed', reason: null }
  return { state: 'failed', reason: 'not_confirmed' }
}
