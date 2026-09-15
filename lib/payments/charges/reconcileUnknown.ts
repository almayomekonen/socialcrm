import { db } from '@/config/db'
import { isTokenChargeReconciliationEstablished } from '@/lib/payments/grow/providerEvidence'
import { insertNextAttempt, listUnknownCharges, markChargeFailed, type ChargeRow, type PaidCharge } from '@/db/payments/charges'
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
 */

export type ReconcileVerdict = { kind: 'paid'; paid: PaidCharge } | { kind: 'not_charged' } | { kind: 'undetermined'; reason: string }
export type ChargeReconciler = (charge: ChargeRow) => Promise<ReconcileVerdict>
export type ReconcileSummary = { paid: number; notCharged: number; undetermined: number }

export const UNKNOWN_RETRY_DELAY_MS = 60 * 60_000
const LOG = '[SubscriptionCharge]'

export const growChargeReconciler: ChargeReconciler = async () =>
  isTokenChargeReconciliationEstablished()
    ? { kind: 'undetermined', reason: 'lookup_interpreter_not_implemented' }
    : { kind: 'undetermined', reason: 'provider_evidence_missing' }

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
