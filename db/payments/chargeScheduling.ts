import type { Knex } from 'knex'
import { db } from '@/config/db'
import { CARD_TRIAL_AMOUNT, CARD_TRIAL_PERIOD, RENEWAL_LEAD_HOURS } from '@/lib/payments/cardTrial/terms'
import { insertNextAttempt, mapCharge } from './charges'
import { TRIAL_END_PERIOD_KEY, renewalPeriodKeySql } from './periodKeys'

/**
 * Creates first attempts for periods that are due. Scheduling is not charging:
 * beginChargeAttempt re-checks cancellation under the subscription lock before
 * anything is dispatched.
 *
 * nextval() runs in the inner SELECT so each row's id is also its
 * groupIdentifier (Grow's transactionGroupIdentifier for every retry).
 */

export async function scheduleDueTrialConversions(limit: number): Promise<number> {
  const res = await db.raw(
    `INSERT INTO billing_charges
       (id, "groupIdentifier", "agencyId", "paymentMethodId", kind, "periodKey", attempt, "firstAttemptAt", amount, currency, "billingPeriod", status, "nextAttemptAt")
     SELECT d.id, d.id, d."agencyId", d."paymentMethodId", 'trial_conversion', ?, 1, now(), ?, 'ILS', ?, 'pending', now()
       FROM (
         SELECT nextval('billing_charges_id_seq') AS id, a.id AS "agencyId", pm.id AS "paymentMethodId"
           FROM agencies a
           JOIN billing_payment_methods pm ON pm."agencyId" = a.id AND pm.status = 'active'
           JOIN subscriptions s ON s."agencyId" = a.id
          WHERE a."trialExempt" = false
            AND a.plan <> 'pro'
            AND a."trialEndsAt" IS NOT NULL
            AND a."trialEndsAt" <= now()
            AND s."cancelAtPeriodEnd" = false
            AND s."growDirectDebitId" IS NULL
            AND NOT EXISTS (SELECT 1 FROM billing_charges bc WHERE bc."agencyId" = a.id AND bc."periodKey" = ?)
          ORDER BY a."trialEndsAt" ASC
          LIMIT ?
       ) d
     ON CONFLICT ("agencyId", "periodKey", attempt) DO NOTHING
     RETURNING id`,
    [TRIAL_END_PERIOD_KEY, CARD_TRIAL_AMOUNT, CARD_TRIAL_PERIOD, TRIAL_END_PERIOD_KEY, limit],
  )
  return res.rows?.length ?? 0
}

/**
 * Renewals only for agencies whose paid period was started by a TOKEN charge —
 * Payment-Link subscribers renew through Grow's standing order and the
 * /api/payments/grow/recurring webhook, and must never be charged here (an
 * agency with a standing order, growDirectDebitId, is excluded as well).
 * Charged up to RENEWAL_LEAD_HOURS early; performAgencyUpgrade keeps unused time.
 */
export async function scheduleDueRenewals(limit: number): Promise<number> {
  const keySql = renewalPeriodKeySql('s')
  const res = await db.raw(
    `INSERT INTO billing_charges
       (id, "groupIdentifier", "agencyId", "paymentMethodId", kind, "periodKey", attempt, "firstAttemptAt", amount, currency, "billingPeriod", status, "nextAttemptAt")
     SELECT d.id, d.id, d."agencyId", d."paymentMethodId", 'renewal', d."periodKey", 1, now(), ?, 'ILS', 'monthly', 'pending', now()
       FROM (
         SELECT nextval('billing_charges_id_seq') AS id, a.id AS "agencyId", pm.id AS "paymentMethodId", ${keySql} AS "periodKey"
           FROM subscriptions s
           JOIN agencies a ON a.id = s."agencyId"
           JOIN billing_payment_methods pm ON pm."agencyId" = a.id AND pm.status = 'active'
          WHERE a.plan = 'pro'
            AND a."planReason" LIKE 'grow:%'
            AND s."billingPeriod" = 'monthly'
            AND s."expiresAt" IS NOT NULL
            AND s."expiresAt" <= now() + (? || ' hours')::interval
            AND s."cancelAtPeriodEnd" = false
            AND s."growDirectDebitId" IS NULL
            AND EXISTS (SELECT 1 FROM billing_charges ok WHERE ok."agencyId" = a.id AND ok.status = 'succeeded')
            AND NOT EXISTS (SELECT 1 FROM billing_charges bc WHERE bc."agencyId" = a.id AND bc."periodKey" = ${keySql})
          ORDER BY s."expiresAt" ASC
          LIMIT ?
       ) d
     ON CONFLICT ("agencyId", "periodKey", attempt) DO NOTHING
     RETURNING id`,
    [CARD_TRIAL_AMOUNT, RENEWAL_LEAD_HOURS, limit],
  )
  return res.rows?.length ?? 0
}

const REOPENABLE_ERRORS = new Set(['cancelled_by_customer', 'no_active_method'])

/**
 * A newly confirmed card retries the latest failed period now. Never for a
 * cancelled subscription, and never for a period that was stopped because it is
 * already paid or already renewed.
 */
export async function scheduleImmediateAttemptForOpenPeriod(trx: Knex.Transaction, agencyId: number, paymentMethodId: number): Promise<number | null> {
  const sub = await trx('subscriptions').where({ agencyId }).first('cancelAtPeriodEnd')
  if (!sub || sub.cancelAtPeriodEnd) return null
  const latest = await trx('billing_charges').where({ agencyId }).orderBy('id', 'desc').first()
  if (!latest) return null
  const reopenable =
    latest.status === 'failed_final' ||
    latest.status === 'failed_retryable' ||
    (latest.status === 'cancelled' && REOPENABLE_ERRORS.has(latest.errorClass))
  if (!reopenable) return null
  return insertNextAttempt(trx, mapCharge(latest), new Date(), paymentMethodId)
}
