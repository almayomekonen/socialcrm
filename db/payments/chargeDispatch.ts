import { db } from '@/config/db'
import { decryptCardToken, getActivePaymentMethod } from './paymentMethods'
import { CHARGES_TABLE, mapCharge, type AttemptContext } from './charges'
import { renewalPeriodKey } from './periodKeys'

/**
 * The last database step before money can move.
 *
 * LOCK ORDER (everywhere in card billing): the agency's `subscriptions` row
 * first, then billing rows. cancelRenewal and confirmCardSetup take the same
 * order, so these transactions serialize instead of deadlocking.
 *
 * This transaction re-checks cancellation and eligibility, stamps
 * `dispatchedAt`, and COMMITS before the caller contacts Grow — no transaction
 * is ever held open across a network call. A cancellation therefore either
 * commits first (this attempt stops here) or sees `dispatchedAt` and tells the
 * customer honestly that a charge is already being processed.
 */
export async function beginChargeAttempt(chargeId: number): Promise<AttemptContext | null> {
  const peek = await db(CHARGES_TABLE).where({ id: chargeId }).first('agencyId')
  if (!peek) return null
  const agencyId = Number(peek.agencyId)

  return db.transaction(async (trx) => {
    const sub = await trx('subscriptions').where({ agencyId }).forUpdate().first('cancelAtPeriodEnd', 'expiresAt')
    const raw = await trx(CHARGES_TABLE).where({ id: chargeId, status: 'in_flight' }).whereNull('dispatchedAt').forUpdate().first()
    if (!raw) return null
    const charge = mapCharge(raw)
    const stop = async (status: 'cancelled' | 'failed_final', errorClass: string): Promise<null> => {
      await trx(CHARGES_TABLE).where({ id: charge.id }).update({ status, errorClass, lockedAt: null, lockedBy: null, updatedAt: new Date() })
      return null
    }

    if (!sub) return stop('failed_final', 'no_subscription')
    if (sub.cancelAtPeriodEnd) return stop('cancelled', 'cancelled_by_customer')

    const agency = await trx('agencies').where({ id: agencyId }).first('plan')
    if (charge.kind === 'trial_conversion' && agency?.plan === 'pro') return stop('cancelled', 'already_paid')
    if (charge.kind === 'renewal' && (!sub.expiresAt || renewalPeriodKey(new Date(sub.expiresAt)) !== charge.periodKey)) {
      return stop('cancelled', 'period_already_renewed')
    }

    const method = await getActivePaymentMethod(agencyId, trx)
    if (!method || !method.cardTokenEnc) return stop('failed_final', 'no_active_method')

    const dispatchedAt = new Date()
    await trx(CHARGES_TABLE).where({ id: charge.id }).update({ paymentMethodId: method.id, dispatchedAt, updatedAt: dispatchedAt })
    return { charge: { ...charge, paymentMethodId: method.id, dispatchedAt }, method, cardToken: decryptCardToken(method) }
  })
}
