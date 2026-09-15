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
