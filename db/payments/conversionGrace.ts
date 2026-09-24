import { CONVERSION_GRACE_HOURS } from '@/lib/payments/cardTrial/terms'

/**
 * Owner decision 2026-09-15: a card trial keeps access after trialEndsAt until
 * its first charge attempt resolves, for at most CONVERSION_GRACE_HOURS.
 *
 * A SQL select fragment for queries that read `agencies` LEFT JOIN
 * `subscriptions` under those exact table names (db/trial.ts getAgencyTrial,
 * lib/quota getEffectiveLeadPlan). It yields NULL — today's behaviour — for any
 * agency without an active card, a cancelled renewal, or a failed first charge.
 * getTrialState decides what the timestamp means; this only computes it. Lives
 * here, not in db/trial.ts, because the trial modules are source-pinned never to
 * mention the cancellation flag.
 */
export const CONVERSION_GRACE_ENDS_AT_SQL = `
  CASE
    WHEN agencies."trialEndsAt" IS NOT NULL
     AND COALESCE(subscriptions."cancelAtPeriodEnd", true) = false
     AND EXISTS (
       SELECT 1 FROM billing_payment_methods pm
        WHERE pm."agencyId" = agencies.id AND pm.status = 'active'
     )
     AND NOT EXISTS (
       SELECT 1 FROM billing_charges bc
        WHERE bc."agencyId" = agencies.id AND bc."periodKey" = 'trial_end'
          AND bc.status IN ('failed_final', 'failed_retryable', 'cancelled')
     )
    THEN agencies."trialEndsAt" + interval '${CONVERSION_GRACE_HOURS} hour'
    ELSE NULL
  END`
