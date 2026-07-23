/**
 * Meta WhatsApp error code → rep-facing Hebrew.
 *
 * This is the ONLY place in the codebase where a Meta error code appears. Nothing
 * downstream — DB column, API payload, or UI — ever sees a number.
 *
 * Categories are chosen by what the נציג can DO, not by what went wrong. That is
 * why 141006 (payment method) and 131031 (account restricted) collapse into one
 * "account" line: they are owner problems, and naming billing state on a rep's
 * message bubble shames the wrong person while giving them nothing actionable
 * (care-charter Law 13). Unknown codes degrade to `generic` so a new Meta code
 * never leaks.
 */
export type WhatsappErrorCategory = 'window_expired' | 'recipient' | 'account' | 'generic'

const CODE_CATEGORY: Record<number, WhatsappErrorCategory> = {
  // Re-engagement / 24-hour customer-care window
  470: 'window_expired',
  131047: 'window_expired',
  131051: 'window_expired',
  // Recipient is not reachable on WhatsApp
  131026: 'recipient',
  131052: 'recipient',
  // Account-level blocks: billing, restriction, quality
  131031: 'account',
  131042: 'account',
  131049: 'account',
  141006: 'account',
}

const CATEGORY_TEXT: Record<WhatsappErrorCategory, string> = {
  window_expired: 'ההודעה לא נשלחה — עברו יותר מ־24 שעות מאז שהליד כתב. אפשר להתקשר אליו.',
  recipient: 'ההודעה לא נשלחה — המספר אינו פעיל ב־WhatsApp.',
  account: 'ההודעה לא נשלחה — שליחת הודעות מושבתת כרגע. נדרשת בדיקה בהגדרות החשבון.',
  generic: 'ההודעה לא נשלחה. נסה שוב.',
}

/** Classify an incoming Meta error code. Used at webhook ingestion time. */
export function mapWhatsappError(code: number | null | undefined): {
  category: WhatsappErrorCategory
  text: string
} {
  const category = (code != null ? CODE_CATEGORY[code] : undefined) ?? 'generic'
  return { category, text: CATEGORY_TEXT[category] }
}

/**
 * Resolve a category key already persisted in `inbox_messages.errorReason` to its
 * copy. Used on the read path. An unrecognised key (written by a future version)
 * degrades to generic rather than throwing.
 */
export function failureTextForCategory(key: string | null | undefined): string | null {
  if (!key) return null
  return CATEGORY_TEXT[key as WhatsappErrorCategory] ?? CATEGORY_TEXT.generic
}
