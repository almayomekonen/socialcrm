import { db } from '@/config/db'
import { getActivePaymentMethod } from '@/db/payments/paymentMethods'
import { claimCreditPackCharge } from '@/db/payments/charges'
import { createCreditPackCharge, isPurchaseRequestKey, packFinalDeclineOnCard } from '@/db/credits/purchases'
import { executeCharge, type ExecuteDeps, type ExecuteOutcome } from '@/lib/payments/charges/executeCharge'
import { isPackSellable, type PackKind } from './config'

/**
 * One explicit credit-pack purchase, start to finish, while the buyer waits.
 *
 *   1. allowed?          purchases are allowlisted per agency, and packs are only
 *                        sold where credits are actually enforced (selling
 *                        credits for unlimited usage would be selling nothing);
 *   2. a saved card?     the existing Grow card token, never a new card flow. A
 *                        card that took a FINAL decline on a pack is not charged
 *                        for packs again (Grow: stop charging the token);
 *   3. pending charge    idempotent on the buyer's request key. Refused while
 *                        another purchase of this agency is still open, so an
 *                        unconfirmed charge can never be doubled by buying again;
 *   4. claim + execute   the SAME executeCharge every Grow token charge uses
 *                        (dispatch evidence gate, unknown handling, decline
 *                        classification); credits are granted only inside its
 *                        Grow-confirmed success transaction.
 *
 * Never automatic: nothing schedules, renews or retries a pack. Where Grow
 * dispatch is not available the pending charge is CANCELLED, so it can never be
 * sent later behind the buyer's back.
 */

export type PurchaseResult =
  | { state: 'granted' | 'already_granted' }
  | { state: 'declined' | 'pending_confirmation' | 'in_progress' }
  | { state: 'refused'; reason: 'not_allowed' | 'no_card' | 'invalid_request' | 'payments_unavailable' | 'card_declined' | 'purchase_pending' }

const WORKER = 'credit-pack-purchase'

export async function purchaseCreditPack(
  input: { agencyId: number; kind: PackKind; requestKey: string },
  deps?: ExecuteDeps,
): Promise<PurchaseResult> {
  const agency = (await db('agencies').where({ id: input.agencyId }).first('plan')) as { plan: string | null } | undefined
  if (!isPackSellable(input.agencyId, agency?.plan)) return { state: 'refused', reason: 'not_allowed' }
  if (!isPurchaseRequestKey(input.requestKey)) return { state: 'refused', reason: 'invalid_request' }

  const method = await getActivePaymentMethod(input.agencyId)
  if (!method) return { state: 'refused', reason: 'no_card' }
  if (await packFinalDeclineOnCard(method.id)) return { state: 'refused', reason: 'card_declined' }

  const created = await createCreditPackCharge({
    agencyId: input.agencyId,
    paymentMethodId: method.id,
    kind: input.kind,
    requestKey: input.requestKey,
  })
  if ('blocked' in created) return { state: 'refused', reason: 'purchase_pending' }
  if (created.replay && created.status !== 'pending') return stateOf(created.status)

  const claimed = await claimCreditPackCharge(created.chargeId, input.agencyId, WORKER)
  if (!claimed) return { state: 'in_progress' }

  const outcome = await executeCharge(claimed.id, deps)
  if (outcome === 'dispatch_disabled') {
    await db('billing_charges')
      .where({ id: claimed.id, status: 'pending' })
      .whereNull('dispatchedAt')
      .update({ status: 'cancelled', errorClass: 'payments_unavailable', updatedAt: new Date() })
    return { state: 'refused', reason: 'payments_unavailable' }
  }
  // Stopped before anything was sent (e.g. the subscription is being cancelled): report what the row says.
  if (outcome === 'skipped') {
    const row = await db('billing_charges').where({ id: claimed.id }).first('status')
    return stateOf(String(row?.status))
  }
  return fromOutcome(outcome)
}

function fromOutcome(o: ExecuteOutcome): PurchaseResult {
  if (o === 'succeeded') return { state: 'granted' }
  if (o === 'already_recorded') return { state: 'already_granted' }
  if (o === 'failed_final' || o === 'failed_retryable') return { state: 'declined' }
  if (o === 'unknown') return { state: 'pending_confirmation' }
  return { state: 'in_progress' }
}

function stateOf(status: string): PurchaseResult {
  if (status === 'succeeded') return { state: 'already_granted' }
  if (status === 'failed_final' || status === 'failed_retryable') return { state: 'declined' }
  if (status === 'unknown') return { state: 'pending_confirmation' }
  if (status === 'cancelled') return { state: 'refused', reason: 'payments_unavailable' }
  return { state: 'in_progress' }
}
