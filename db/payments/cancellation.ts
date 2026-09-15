import type { Knex } from 'knex'
import { db } from '@/config/db'
import { track, type AnalyticsEventName } from '@/lib/analytics/track'
import { getTrialState, hasActiveProductAccess } from '@/lib/trial'
import { getAgencyTrial } from '@/db/trial'
import { hasConfirmedPaymentMethod, supersedePendingPaymentMethods } from './paymentMethods'
import { insertNextAttempt, mapCharge } from './charges'

/**
 * What a cancellation or resume means for card-token billing. Called from
 * actions/subscription.ts inside its transaction, AFTER the subscriptions row
 * is locked — the lock order charge dispatch and card confirmation use.
 */

export type CardBillingOnCancel = {
  billing: 'card_token' | 'payment_link'
  /** A charge already sent to Grow whose outcome is not settled: the customer must not be told "no charge". */
  chargeInProgress: boolean
  /** A Grow standing order may still need stopping by the operator (Payment Link). */
  standingOrderToStop: boolean
}

/**
 * - every pending card setup → invalid: a card or reactivation page opened
 *   before the cancellation can no longer undo it when its callback arrives;
 * - every undispatched charge (pending, or claimed but not yet sent) → cancelled;
 * - a dispatched charge still open is left alone and reported.
 */
export async function settleCardBillingOnCancel(trx: Knex.Transaction, agencyId: number): Promise<CardBillingOnCancel> {
  const cardBilled = await hasConfirmedPaymentMethod(agencyId, trx)
  const sub = await trx('subscriptions').where({ agencyId }).first('growDirectDebitId')
  await supersedePendingPaymentMethods(trx, agencyId, 'superseded_by_cancellation')
  await trx('billing_charges')
    .where({ agencyId })
    .where((q) => q.where({ status: 'pending' }).orWhere((w) => w.where({ status: 'in_flight' }).whereNull('dispatchedAt')))
    .update({ status: 'cancelled', errorClass: 'cancelled_by_customer', lockedAt: null, lockedBy: null, updatedAt: new Date() })
  const open = await trx('billing_charges').where({ agencyId }).whereIn('status', ['in_flight', 'unknown']).whereNotNull('dispatchedAt').first('id')
  return {
    billing: cardBilled ? 'card_token' : 'payment_link',
    chargeInProgress: Boolean(open),
    standingOrderToStop: !cardBilled || Boolean(sub?.growDirectDebitId),
  }
}

export const cancelOutcome = (c: CardBillingOnCancel): { ok: true; chargeInProgress?: true } =>
  c.chargeInProgress ? { ok: true, chargeInProgress: true } : { ok: true }

/**
 * Resuming a card-billed subscription whose access has already ended would make
 * the next scheduler pass charge immediately, without the customer being told.
 * That path goes through reactivation (new terms acceptance, explicit card page)
 * until the owner decides otherwise (plan Amendment A6, D4).
 */
export async function isCardResumeBlocked(agencyId: number): Promise<boolean> {
  if (!(await hasConfirmedPaymentMethod(agencyId))) return false
  const row = await getAgencyTrial(agencyId)
  if (!row) return false
  return !hasActiveProductAccess(getTrialState(row, new Date()).status)
}

/** A resumed subscription gets back every period the customer's cancellation stopped. */
export async function reopenCustomerCancelledCharges(trx: Knex.Transaction, agencyId: number): Promise<number> {
  const rows = await trx('billing_charges as c')
    .where({ 'c.agencyId': agencyId, 'c.status': 'cancelled', 'c.errorClass': 'cancelled_by_customer' })
    .whereNotExists((q) => q.select(1).from('billing_charges as later').whereRaw('later."agencyId" = c."agencyId" AND later."periodKey" = c."periodKey" AND later.attempt > c.attempt'))
    .select('c.*')
  let reopened = 0
  for (const row of rows) if (await insertNextAttempt(trx, mapCharge(row), new Date())) reopened++
  return reopened
}

export async function trackBillingTransition(
  agencyId: number,
  userId: number,
  event: Extract<AnalyticsEventName, 'subscription_cancel_requested' | 'subscription_resumed'>,
  chargeInProgress?: boolean,
): Promise<void> {
  const billing = (await hasConfirmedPaymentMethod(agencyId, db)) ? 'card_token' : 'payment_link'
  const props = event === 'subscription_cancel_requested' ? { billing, chargeInProgress: Boolean(chargeInProgress) } : { billing }
  await track({ agencyId, userId, event, props })
}
