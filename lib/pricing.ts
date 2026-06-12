/**
 * Single source of truth for subscription pricing. Every user-facing price
 * MUST come from here — never hardcode amounts in components or copy.
 *
 * Display-only: the amounts actually CHARGED are configured in the Grow
 * dashboard (the static GROW_PAYMENT_LINK). When changing prices here, the
 * Grow link amount must be updated in the same release — and vice versa.
 * Annual is currently messaging only; there is no annual payment link yet.
 */
export const PRICING = {
  currency: '₪',
  monthly: 89,
  annual: 588,
} as const

// Derived — never hardcode these anywhere, so they cannot drift.
export const ANNUAL_MONTHLY_EQUIVALENT = PRICING.annual / 12 // 49
export const ANNUAL_SAVINGS = PRICING.monthly * 12 - PRICING.annual // 480
export const ANNUAL_DISCOUNT_PERCENT = Math.round((ANNUAL_SAVINGS / (PRICING.monthly * 12)) * 100) // 45
