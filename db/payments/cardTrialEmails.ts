import { db } from '@/config/db'
import { SUBSCRIPTION_CHARGE_KINDS } from '@/db/payments/charges'
import { firstChargeAt } from '@/lib/payments/cardTrial/firstCharge'

/**
 * Audience reads for the card-trial emails. Both are driven by the PERSISTED
 * trial end, so an email can never claim a date the billing page disagrees with.
 */

/** Hours before the first charge that the reminder window opens/closes (~2 days). */
export const REMINDER_WINDOW_HOURS = { from: 36, to: 60 }

export async function agencyFirstChargeAt(agencyId: number): Promise<Date | null> {
  const row = await db('agencies').where({ id: agencyId }).first('trialEndsAt')
  return firstChargeAt(row?.trialEndsAt)
}

/**
 * Owners whose card trial is charged in roughly two days. Excluded: no active
 * card, a cancelled renewal, a Grow standing order, a trial end that has already
 * passed (no "in two days" after the fact), and any agency whose first charge is
 * already settled or being attempted.
 */
export function cardTrialChargeSoonQuery() {
  return db('users as u')
    .join('agencies as a', 'a.id', 'u.agencyId')
    .join('billing_payment_methods as pm', function () {
      this.on('pm.agencyId', 'a.id').andOn(db.raw("pm.status = 'active'"))
    })
    .join('subscriptions as s', 's.agencyId', 'a.id')
    .where('u.role', 'ADMIN')
    .where('u.suspended', false)
    .whereNotNull('u.email')
    .where('a.trialExempt', false)
    .where('a.plan', '<>', 'pro')
    .whereNotNull('a.trialEndsAt')
    .where('a.trialEndsAt', '>', db.raw(`now() + (? || ' hours')::interval`, [REMINDER_WINDOW_HOURS.from]))
    .where('a.trialEndsAt', '<=', db.raw(`now() + (? || ' hours')::interval`, [REMINDER_WINDOW_HOURS.to]))
    .where('s.cancelAtPeriodEnd', false)
    .whereNull('s.growDirectDebitId')
    .whereNotExists((q) => q.select(1).from('billing_charges as bc').whereRaw('bc."agencyId" = a.id AND bc."periodKey" = ?', ['trial_end']))
    .select('u.id as userId', 'u.agencyId', 'u.email', 'u.firstName')
}

export type ChargeFailureNotice = {
  periodKey: string
  /** No attempt is left: the card must be replaced for the subscription to continue. */
  final: boolean
  /** When we will try the same card again, if we will. */
  nextAttemptAt: Date | null
}

/**
 * The charge failure this agency should be told about, or null.
 *
 * Deliberately excludes a failure that no longer means anything to the customer:
 * a period that has since been paid (a later attempt succeeded), and an agency
 * that has cancelled — telling someone who cancelled to "update your card" is
 * both wrong and pushy. `unknown` is not a failure and never appears here; an
 * unreconciled outcome must never be announced as a decline.
 */
export async function agencyChargeFailure(agencyId: number): Promise<ChargeFailureNotice | null> {
  const failure = await db('billing_charges as c')
    .join('subscriptions as s', 's.agencyId', 'c.agencyId')
    .where('c.agencyId', agencyId)
    .whereIn('c.kind', SUBSCRIPTION_CHARGE_KINDS as string[])
    .whereIn('c.status', ['failed_final', 'failed_retryable'])
    .where('s.cancelAtPeriodEnd', false)
    .whereNotExists((q) =>
      q
        .select(1)
        .from('billing_charges as paid')
        .whereRaw('paid."agencyId" = c."agencyId" AND paid."periodKey" = c."periodKey" AND paid.status = ?', ['succeeded']),
    )
    .orderBy('c.id', 'desc')
    .first('c.periodKey as periodKey', 'c.status as status')
  if (!failure) return null

  const pending = await db('billing_charges')
    .where({ agencyId, periodKey: failure.periodKey, status: 'pending' })
    .min({ at: 'nextAttemptAt' })
    .first()

  return {
    periodKey: String(failure.periodKey),
    final: failure.status === 'failed_final',
    nextAttemptAt: (pending?.at as Date | null) ?? null,
  }
}
