import { db } from '@/config/db'
import { isTokenChargeReconciliationEstablished } from '@/lib/payments/grow/providerEvidence'
import { insertNextAttempt, listUnknownCharges, markChargeFailed, type ChargeRow, type PaidCharge } from '@/db/payments/charges'
import { decryptCardToken, getPaymentMethodById } from '@/db/payments/paymentMethods'
import { tryExactGrowIdentifier } from '@/lib/payments/grow/identifiers'
import { applySuccessfulCharge } from './applySuccessfulCharge'

/**
 * A dispatched attempt whose outcome is unknown may have charged the customer.
 * Only a verdict can move it: `paid` settles it through Model B, `not_charged`
 * schedules a NEW attempt (new unique identifier, same group identifier), and
 * `undetermined` leaves it untouched for the next pass or manual review.
 *
 * The live reconciler is undetermined: Grow does not document the response of
 * getTokenTransactionsByExternalIdentifiers, so no verdict is derived from it
 * until sandbox evidence exists (providerEvidence). Nothing is ever retried on
 * a guess.
 *
 * A token charge cannot be reconciled by waiting for a callback. Grow's server
 * updates apply to the FIRST transaction only, so every subsequent charge is
 * known from its synchronous response or from a lookup — never from an update
 * that will not arrive.
 */

export type ReconcileVerdict = { kind: 'paid'; paid: PaidCharge } | { kind: 'not_charged' } | { kind: 'undetermined'; reason: string }
export type ChargeReconciler = (charge: ChargeRow) => Promise<ReconcileVerdict>
export type ReconcileSummary = { paid: number; notCharged: number; undetermined: number }

export const UNKNOWN_RETRY_DELAY_MS = 60 * 60_000
const LOG = '[SubscriptionCharge]'

/**
 * The card to ask Grow about is the one THAT ATTEMPT used, not whatever the
 * agency has on file now: a customer who replaced a card while an outcome was
 * unknown would otherwise have the wrong token queried, and the answer would be
 * about a different card. Ownership is re-checked here rather than assumed —
 * the method id travels on the charge row, and a mismatch means something is
 * wrong enough to stop rather than guess with.
 */
export type ReconciliationSubject = { cardToken: string; uniqueIdentifier: number }

export async function reconciliationSubject(charge: ChargeRow): Promise<ReconciliationSubject | { error: string }> {
  const method = await getPaymentMethodById(charge.paymentMethodId)
  if (!method) return { error: 'attempt_payment_method_missing' }
  if (method.agencyId !== charge.agencyId) return { error: 'attempt_payment_method_agency_mismatch' }
  try {
    const cardToken = decryptCardToken(method)
    if (!cardToken) return { error: 'attempt_card_token_unavailable' }
    // The attempt's own id is its transactionUniqueIdentifier (executeCharge).
    // Exact or refuse: bigint columns arrive as strings from an unmapped row,
    // and a rounded id names a DIFFERENT transaction.
    const uniqueIdentifier = tryExactGrowIdentifier(charge.id)
    if (uniqueIdentifier === null) return { error: 'attempt_identifier_not_exact' }
    return { cardToken, uniqueIdentifier }
  } catch {
    return { error: 'attempt_card_token_unreadable' }
  }
}

export const growChargeReconciler: ChargeReconciler = async (charge) => {
  // Resolved first, and on every pass: if the attempt's card cannot be
  // identified there is nothing to ask about, whatever the gate says.
  const subject = await reconciliationSubject(charge)
  if ('error' in subject) return { kind: 'undetermined', reason: subject.error }
  if (!isTokenChargeReconciliationEstablished()) return { kind: 'undetermined', reason: 'provider_evidence_missing' }
  // Gate open, interpreter still absent: Grow does not document this response,
  // and a verdict invented here would settle or re-charge real money.
  return { kind: 'undetermined', reason: 'lookup_interpreter_not_implemented' }
}

export async function reconcileUnknownCharges(limit: number, reconcile: ChargeReconciler = growChargeReconciler): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { paid: 0, notCharged: 0, undetermined: 0 }
  for (const charge of await listUnknownCharges(limit)) {
    let verdict: ReconcileVerdict
    try {
      verdict = await reconcile(charge)
    } catch (err) {
      verdict = { kind: 'undetermined', reason: `reconciler_error:${String(err).slice(0, 80)}` }
    }
    if (verdict.kind === 'paid') {
      await applySuccessfulCharge(charge, verdict.paid)
      summary.paid++
    } else if (verdict.kind === 'not_charged') {
      await db.transaction(async (trx) => {
        await markChargeFailed(trx, charge.id, { status: 'failed_retryable', errorClass: 'reconciled_not_charged', errorId: null, errorMessage: '', statusCode: null })
        await insertNextAttempt(trx, charge, new Date(Date.now() + UNKNOWN_RETRY_DELAY_MS))
      })
      summary.notCharged++
    } else {
      summary.undetermined++
    }
  }
  if (summary.undetermined) console.warn(`${LOG} unknown charge outcomes awaiting reconciliation`, { count: summary.undetermined })
  return summary
}
