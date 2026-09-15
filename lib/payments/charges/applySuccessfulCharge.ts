import { db } from '@/config/db'
import { performAgencyUpgrade } from '@/lib/quota/performUpgrade'
import { track } from '@/lib/analytics/track'
import { markChargeFailed, markChargeSucceeded, type ChargeRow, type PaidCharge } from '@/db/payments/charges'

/**
 * A Grow-confirmed token charge becomes paid time through the SAME Model B path
 * every Grow payment uses: `payments` row (UNIQUE transactionId) +
 * performAgencyUpgrade(`grow:<transactionId>`) in one transaction, so
 * isPaidPeriodActive, entitlements and billing history need no change.
 *
 * CANCELLATION SURVIVES. performAgencyUpgrade resets cancelAtPeriodEnd on an
 * existing subscription. A charge that was already dispatched when the customer
 * cancelled may still succeed; the paid period stands (what happens to that
 * money is owner decision D1), but the cancellation is restored in the same
 * transaction so nothing renews.
 *
 * DUPLICATES. A 23505 on `payments` means this Grow transaction is already
 * recorded — the charge is settled without a second extension. A 23505 while
 * settling means ANOTHER attempt of this period already succeeded: surfaced
 * loudly for manual review.
 */

const PG_UNIQUE_VIOLATION = '23505'
const LOG = '[SubscriptionCharge]'
const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === PG_UNIQUE_VIOLATION

export async function applySuccessfulCharge(charge: ChargeRow, paid: PaidCharge): Promise<{ applied: boolean }> {
  try {
    const applied = await db.transaction(async (trx) => {
      const sub = await trx('subscriptions').where({ agencyId: charge.agencyId }).forUpdate().first('cancelAtPeriodEnd')
      if (!(await markChargeSucceeded(trx, charge.id, paid))) return false
      await trx('payments').insert({ transactionId: paid.transactionId, agencyId: charge.agencyId })
      const result = await performAgencyUpgrade(charge.agencyId, `grow:${paid.transactionId}`, trx, charge.billingPeriod)
      if ('error' in result) throw new Error(`upgrade_failed:${result.error}`)
      if (sub?.cancelAtPeriodEnd) {
        await trx('subscriptions').where({ agencyId: charge.agencyId }).update({ cancelAtPeriodEnd: true, updatedAt: new Date() })
      }
      return true
    })
    if (applied) await announce(charge)
    return { applied }
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    return settleDuplicate(charge, paid)
  }
}

async function settleDuplicate(charge: ChargeRow, paid: PaidCharge): Promise<{ applied: boolean }> {
  try {
    await markChargeSucceeded(db, charge.id, paid)
    console.warn(`${LOG} Grow transaction already recorded — settled without a second extension`, { chargeId: charge.id, agencyId: charge.agencyId })
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    await markChargeFailed(db, charge.id, {
      status: 'failed_final',
      errorClass: 'duplicate_period_success',
      errorId: null,
      errorMessage: 'second_success_for_paid_period',
      statusCode: paid.statusCode,
    })
    console.error(`${LOG} POSSIBLE DOUBLE CHARGE — a second Grow success for an already-paid period; review manually`, {
      chargeId: charge.id,
      agencyId: charge.agencyId,
      periodKey: charge.periodKey,
    })
  }
  return { applied: false }
}

async function announce(charge: ChargeRow): Promise<void> {
  await track({ agencyId: charge.agencyId, event: 'subscription_activated', props: { period: charge.billingPeriod, source: 'card_token', kind: charge.kind } })
  await track({ agencyId: charge.agencyId, event: 'subscription_charge_succeeded', props: { chargeId: charge.id, kind: charge.kind, attempt: charge.attempt } })
}
