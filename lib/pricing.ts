import { TRIAL_LENGTH_DAYS } from '@/lib/trial'

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

/**
 * The public offer, in one sentence, derived rather than typed.
 *
 * Every marketing FAQ that answers "how much does it cost?" renders THIS. The
 * previous answers each carried their own hand-written version and all three
 * drifted into describing a free plan that does not exist: an account without a
 * verified card has no product access at all (lib/trial), so "free up to 50
 * leads, no credit card" described a state the system cannot be in.
 *
 * Kept next to the prices so a price change cannot leave the sentence behind.
 */
export const TRIAL_OFFER_FAQ_ANSWER =
  `${TRIAL_LENGTH_DAYS} ימי התנסות במערכת המלאה, ללא חיוב. כדי להתחיל נדרש כרטיס אשראי, ` +
  `והוא לא מחויב במהלך ההתנסות. בתום ${TRIAL_LENGTH_DAYS} הימים המנוי הוא ` +
  `${PRICING.currency}${PRICING.monthly} לחודש עד לביטול, ואפשר לבטל בכל רגע לפני החיוב הראשון — ואז לא יבוצע חיוב.`
