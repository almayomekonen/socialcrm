import { db } from '@/config/db'
import { track } from '@/lib/analytics/track'
import { chargeToken } from '@/lib/payments/grow/api'
import { GrowTransportError } from '@/lib/payments/grow/http'
import { classifyTokenChargeError } from '@/lib/payments/grow/tokenErrors'
import { isTokenChargeDispatchEstablished } from '@/lib/payments/grow/providerEvidence'
import { CHARGE_DESCRIPTION } from '@/lib/payments/cardTrial/terms'
import { markPaymentMethodStatus } from '@/db/payments/paymentMethods'
import { insertNextAttempt, markChargeFailed, markChargeUnknown, releaseUndispatchedClaim, type ChargeRow } from '@/db/payments/charges'
import { beginChargeAttempt } from '@/db/payments/chargeDispatch'
import { dispatchLifecycleEvent } from '@/lib/emailAutomations/live'
import { agencyOwner } from '@/lib/emailAutomations/recipients'
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
const liveDeps: ExecuteDeps = { chargeToken, dispatchAllowed: () => isTokenChargeDispatchEstablished() }

/**
 * Called only after the failure has COMMITTED, so the email can never describe a
 * state the database did not keep — and never inside the transaction, which must
 * not be held across an email send. A notification failure must not turn a
 * settled decline into a thrown charge pass, so it is logged and swallowed: the
 * row is already correct and the billing page still shows the truth.
 */
async function failed(charge: ChargeRow, errorClass: 'final' | 'retryable'): Promise<void> {
  await track({ agencyId: charge.agencyId, event: 'subscription_charge_failed', props: { chargeId: charge.id, kind: charge.kind, attempt: charge.attempt, errorClass } })
  try {
    const owner = await agencyOwner(charge.agencyId)
    if (!owner) {
      console.warn(`${LOG} payment-failure email: no owner resolved`, { agencyId: charge.agencyId })
      return
    }
    await dispatchLifecycleEvent('subscription.payment_failed', owner, new Date())
  } catch (err) {
    console.error(`${LOG} payment-failure email not dispatched`, { agencyId: charge.agencyId, chargeId: charge.id, err: String(err) })
  }
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
      groupIdentifier: charge.groupIdentifier,
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
