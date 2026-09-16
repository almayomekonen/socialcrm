import { db } from '@/config/db'
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
