import type { BillingPeriod } from '@/lib/pricing'

export const FREE_LEAD_LIMIT = 50

export const SUBSCRIPTION_PERIOD_DAYS = 30

// Period-aware subscription lengths. monthly intentionally aliases
// SUBSCRIPTION_PERIOD_DAYS so the two can never drift.
export const PERIOD_DAYS: Record<BillingPeriod, number> = {
  monthly: SUBSCRIPTION_PERIOD_DAYS,
  annual: 365,
}
