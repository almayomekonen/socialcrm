import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import { chargeToken } from '@/lib/payments/grow/api'
import { GrowTransportError } from '@/lib/payments/grow/http'
import { classifyTokenChargeError } from '@/lib/payments/grow/tokenErrors'
import { isTokenChargeDispatchEstablished } from '@/lib/payments/grow/providerEvidence'
import { assertGrowRuntime } from '@/lib/payments/grow/config'
import { CHARGE_DESCRIPTION } from '@/lib/payments/cardTrial/terms'
import { markPaymentMethodStatus } from '@/db/payments/paymentMethods'
import { insertNextAttempt, markChargeFailed, markChargeUnknown, releaseUndispatchedClaim, type ChargeRow } from '@/db/payments/charges'
import { beginChargeAttempt } from '@/db/payments/chargeDispatch'
import { notifyAgencyOwner } from '@/lib/payments/notifyOwner'
import { applySuccessfulCharge } from './applySuccessfulCharge'
import { nextRetryAt } from './retryPolicy'

/**
 * One claimed charge attempt, start to finish. Exactly one Grow request, never
 * retried here, never inside a database transaction.
 *
 *   dispatch not established → claim given back, nothing sent (Gate B)
 *   paid                     → Model B paid period (applySuccessfulCharge)
 *   documented final decline → card invalid, no retry (Grow: stop charging the token)
 *   documented retryable     → new attempt at +1/+3/+7 days, same group identifier
 *   anything else            → UNKNOWN: an unclassified Grow error (it may be a
 *                              duplicate-identifier refusal), an unrecognized
 *                              answer, a timeout or a lost response. Reconciled,
 *                              never retried blindly, never called a decline.
 */

export type ExecuteOutcome = 'succeeded' | 'already_recorded' | 'failed_final' | 'failed_retryable' | 'unknown' | 'skipped' | 'dispatch_disabled'
export type ExecuteDeps = { chargeToken: typeof chargeToken; dispatchAllowed: () => boolean }

const LOG = '[SubscriptionCharge]'
const liveDeps: ExecuteDeps = {
  chargeToken,
  dispatchAllowed: () => {
    // Evidence is per environment; a runtime we may not call Grow from never dispatches.
    try {
      return isTokenChargeDispatchEstablished(assertGrowRuntime().mode)
    } catch {
      return false
    }
  },
}

/**
 * Called only after the failure has COMMITTED, so the email can never describe a
 * state the database did not keep — and never inside the transaction, which must
 * not be held across an email send. notifyAgencyOwner swallows its own failures
 * and imports the mailer lazily, so neither a Resend outage nor an unset RESEND
 * key can turn a settled decline into a thrown charge pass.
 */
async function failed(charge: ChargeRow, errorClass: 'final' | 'retryable'): Promise<void> {
  await track({ agencyId: charge.agencyId, event: 'subscription_charge_failed', props: { chargeId: charge.id, kind: charge.kind, attempt: charge.attempt, errorClass } })
  await notifyAgencyOwner('subscription.payment_failed', charge.agencyId, LOG)
}

export async function executeCharge(chargeId: number, deps: ExecuteDeps = liveDeps): Promise<ExecuteOutcome> {
  if (!deps.dispatchAllowed()) {
    await releaseUndispatchedClaim(chargeId)
    return 'dispatch_disabled'
  }
  const ctx = await beginChargeAttempt(chargeId)
  if (!ctx) return 'skipped'
  const { charge, method, cardToken } = ctx

  let result
  try {
    result = await deps.chargeToken({
      cardToken,
      holder: method.holder,
      sum: charge.amount,
      description: CHARGE_DESCRIPTION,
      uniqueIdentifier: charge.id,
    })
  } catch (err) {
    const reason = err instanceof GrowTransportError ? `transport_${err.reason}` : 'unexpected_error'
    await markChargeUnknown(charge.id, reason)
    console.error(`${LOG} outcome unknown — reconcile before any retry`, { chargeId: charge.id, agencyId: charge.agencyId, reason })
    return 'unknown'
  }

  if (result.kind === 'paid') {
    const { applied } = await applySuccessfulCharge(charge, result)
    return applied ? 'succeeded' : 'already_recorded'
  }
  if (result.kind === 'unrecognized') {
    await markChargeUnknown(charge.id, 'unrecognized_response', { statusCode: result.statusCode })
    console.error(`${LOG} unrecognized Grow answer — outcome unknown`, { chargeId: charge.id, agencyId: charge.agencyId })
    return 'unknown'
  }

  const errorClass = classifyTokenChargeError(result.errorId, result.errorMessage)
  const detail = { errorId: result.errorId, errorMessage: result.errorMessage, statusCode: null }
  if (errorClass === 'duplicate_identifier') {
    // Grow has already seen this transactionUniqueIdentifier, so a charge for it
    // may exist. Reconcile it; never send a fresh one with a new identifier,
    // which is exactly how a customer gets billed twice.
    await markChargeUnknown(charge.id, 'duplicate_identifier', detail)
    console.error(`${LOG} duplicate identifier — reconcile, do not charge again`, { chargeId: charge.id, agencyId: charge.agencyId })
    return 'unknown'
  }
  if (errorClass === 'unknown') {
    await markChargeUnknown(charge.id, 'grow_error_unclassified', detail)
    console.error(`${LOG} unclassified Grow error — outcome unknown`, { chargeId: charge.id, agencyId: charge.agencyId, errorId: result.errorId })
    return 'unknown'
  }
  if (errorClass === 'final') {
    await db.transaction(async (trx) => {
      await markChargeFailed(trx, charge.id, { status: 'failed_final', errorClass, ...detail })
      await markPaymentMethodStatus(trx, method.id, 'invalid', 'final_decline')
    })
    await failed(charge, 'final')
    return 'failed_final'
  }
  await db.transaction(async (trx) => {
    await markChargeFailed(trx, charge.id, { status: 'failed_retryable', errorClass, ...detail })
    const next = nextRetryAt(charge.firstAttemptAt, charge.attempt)
    if (next) await insertNextAttempt(trx, charge, next)
  })
  await failed(charge, 'retryable')
  return 'failed_retryable'
}
