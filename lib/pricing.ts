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
  `${TRIAL_LENGTH_DAYS} ימי ניסיון במערכת המלאה, ללא חיוב. כדי להתחיל שומרים כרטיס אשראי, ` +
  `והוא לא מחויב בתקופת הניסיון. בתום ${TRIAL_LENGTH_DAYS} הימים המנוי עולה ` +
  `${PRICING.currency}${PRICING.monthly} לחודש ומתחדש אוטומטית עד לביטול. אפשר לבטל בכל רגע לפני החיוב הראשון, ואז לא יבוצע חיוב. ` +
  // ₪1 is Grow's token-check amount (TOKEN_SAVE_SUM in lib/payments/cardTrial/terms.ts,
  // which imports this module, so it is not imported back). Same disclosure as checkout.
  `לצורך אימות הכרטיס תיתכן הקפאה זמנית של ${PRICING.currency}1 אצל חברת האשראי. זו אינה גבייה, והיא משתחררת לפי ספק הסליקה בתוך עד 10 ימים.`

/**
 * The label of every marketing sign-up button, so the offer reads the same in
 * the navbar, the hero and every closing CTA. No "free": the trial needs a
 * saved card before the CRM opens (lib/trial).
 */
export const TRIAL_CTA_LABEL = `התחילו ${TRIAL_LENGTH_DAYS} ימי ניסיון`
