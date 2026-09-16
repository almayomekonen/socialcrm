import { PRICING } from '@/lib/pricing'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'

/**
 * Card-required trial constants that are either DOCUMENTED by Grow or DECIDED
 * by the owner (2026-09-15).
 *
 * Deliberately absent until Gate B evidence exists (spec §9): the statusCode of
 * a successful token save, and any customer-facing notice about Grow's ₪1 token
 * check — its capture/release behaviour needs Grow's written confirmation.
 */

/** Bump when the customer-facing terms below change; stored with each card setup. */
export const CARD_TRIAL_TERMS_VERSION = '2026-09-15'

/** Owner decision: trials convert to monthly only. */
export const CARD_TRIAL_PERIOD = 'monthly' as const
export const CARD_TRIAL_AMOUNT = PRICING.monthly

/** Grow "Get Token Only" (create-payment-process-6): "Total amount must be 1". */
export const TOKEN_SAVE_SUM = 1

/** Owner decision: access continues after trialEndsAt until the first charge attempt resolves, at most this long. */
export const CONVERSION_GRACE_HOURS = 1
/** Design: a token-billed renewal is attempted up to this long before expiresAt (unused paid time is preserved). */
export const RENEWAL_LEAD_HOURS = 1

/** Sent to Grow: letters, digits and spaces only (Grow forbids special characters). */
export const TOKEN_PROCESS_DESCRIPTION = 'SocialCRM Pro אמצעי תשלום'
export const CHARGE_DESCRIPTION = 'SocialCRM Pro מנוי חודשי'

export function cardTrialTermsLine(): string {
  return `${TRIAL_LENGTH_DAYS} ימים ללא עלות, ולאחר מכן ₪${CARD_TRIAL_AMOUNT} לחודש. אפשר לבטל בכל רגע לפני סיום הניסיון ולא יבוצע חיוב.`
}

/**
 * The subscription disclosure shown BEFORE the redirect, above the primary
 * action (plan Amendment A6 S1). Before activation the trial is described as
 * "7 days from activation" — the exact first-charge date does not exist yet and
 * is shown afterwards from the persisted trial end (firstCharge.ts).
 *
 * Deliberately silent about Grow's ₪1 card check: that copy waits for Grow's
 * written answer (Gate B, B2 / owner decision D3).
 */
export function cardTrialDisclosureLines(): string[] {
  return [
    `${TRIAL_LENGTH_DAYS} ימים ללא עלות מרגע ההפעלה. היום לא יבוצע חיוב.`,
    `בתום ${TRIAL_LENGTH_DAYS} הימים יחויב הכרטיס ב־₪${CARD_TRIAL_AMOUNT} לחודש, ומדי חודש לאחר מכן, עד לביטול.`,
    'אפשר לבטל בכל רגע לפני החיוב הראשון בעמוד המנוי — ואז לא יבוצע חיוב.',
  ]
}

/** The label of the explicit subscription consent — separate from Grow's card-storage checkbox. */
export const CARD_TRIAL_CONSENT_LABEL = 'אני מאשר/ת את תנאי המנוי: חיוב חודשי אוטומטי בתום תקופת הניסיון, עד לביטול'
