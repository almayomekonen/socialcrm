export type BillingPeriod = 'monthly' | 'annual'

export const PRICING = {
  currency: '₪',
  monthly: 89,
  annual: 588,
} as const

// Derived — never hardcode these anywhere, so they cannot drift.
export const ANNUAL_MONTHLY_EQUIVALENT = PRICING.annual / 12 // 49
export const ANNUAL_SAVINGS = PRICING.monthly * 12 - PRICING.annual // 480
export const ANNUAL_DISCOUNT_PERCENT = Math.round((ANNUAL_SAVINGS / (PRICING.monthly * 12)) * 100) // 45
