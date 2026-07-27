import type { Knex } from 'knex'
import { db } from '@/config/db'
import { PERIOD_DAYS } from './constants'
import type { BillingPeriod } from '@/lib/pricing'

export type PerformUpgradeResult = { success: true } | { error: 'not_found' }

export async function performAgencyUpgrade(
  agencyId: number,
  reason: string,
  q: Knex = db,

  period: BillingPeriod = 'monthly',
): Promise<PerformUpgradeResult> {
  const exists = await q('agencies').where({ id: agencyId }).first()
  if (!exists) return { error: 'not_found' }

  await q('agencies').where({ id: agencyId }).update({ plan: 'pro', planReason: reason })
  await q('clients').where({ agencyId, overQuota: true }).update({ overQuota: false })

  // Prepaid renewal (Model B), computed ATOMICALLY in the ON CONFLICT DO UPDATE:
  //   new expiresAt = GREATEST(now, existing expiresAt) + <period> days
  // Early renewal preserves unused paid time; late renewal starts at now. Doing
  // the max()+interval inside the upsert (Postgres row-locks the unique(agencyId)
  // row) makes two concurrent DISTINCT payments both stack correctly — a JS
  // read-then-write could lose one. Uses the existing 30/365 PERIOD_DAYS
  // convention, NOT calendar-month/year arithmetic. GREATEST ignores a NULL
  // existing value, so a first insert / legacy null row starts cleanly at now.
  // This runs only after the webhook's `payments` insert succeeds, so a
  // duplicate transactionId rolls the whole transaction back — no double extend.
  const days = PERIOD_DAYS[period]
  await q.raw(
    `INSERT INTO subscriptions
       ("agencyId", "planStartedAt", "expiresAt", "cancelAtPeriodEnd", "billingPeriod", "createdAt", "updatedAt")
     VALUES (?, now(), now() + (? || ' days')::interval, false, ?, now(), now())
     ON CONFLICT ("agencyId") DO UPDATE SET
       "expiresAt"         = GREATEST(now(), subscriptions."expiresAt") + (? || ' days')::interval,
       "planStartedAt"     = now(),
       "billingPeriod"     = EXCLUDED."billingPeriod",
       "cancelAtPeriodEnd" = false,
       "updatedAt"         = now()`,
    [agencyId, days, period, days],
  )

  return { success: true }
}
