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

export type FailureTooltipCopy = { title: string; explanation: string; action: string }

/**
 * Product-guidance copy for the failed-message hover/focus tooltip, keyed on the
 * already-persisted category (NOT parsed from any rendered string). Plain-language
 * "what happened → why → what now" for a small-business owner: no error codes, no
 * Meta jargon, and NO debugging attribution line — the copy names WhatsApp's role
 * naturally ("WhatsApp מאפשרת…"), so a separate "הסטטוס התקבל מ־WhatsApp." line is
 * not needed.
 *
 * window_expired points to a PHONE CALL, not templates: sending an approved
 * template is a flag-gated, approval-dependent capability that is absent from the
 * inbox surface, so promising it here would be untruthful. Unknown/absent category
 * → generic, so a future key never renders an empty or fabricated cause.
 */
const FAILURE_TOOLTIP: Record<WhatsappErrorCategory, FailureTooltipCopy> = {
  window_expired: {
    title: 'לא ניתן לשלוח את ההודעה',
    explanation: 'WhatsApp מאפשרת לשלוח הודעה רגילה רק עד 24 שעות מההודעה האחרונה של הלקוח.',
    action: 'כדי ליצור איתו קשר עכשיו, אפשר להתקשר אליו.',
  },
  recipient: {
    title: 'לא ניתן לשלוח את ההודעה',
    explanation: 'נראה שהמספר הזה לא זמין ב־WhatsApp.',
    action: 'בדוק שהמספר נכון או צור קשר עם הלקוח בדרך אחרת.',
  },
  account: {
    title: 'לא ניתן לשלוח הודעות כרגע',
    explanation: 'WhatsApp לא מאפשרת כרגע לשלוח הודעות מהחשבון המחובר.',
    action: 'בדוק את חשבון WhatsApp המחובר ל־SocialCRM.',
  },
  generic: {
    title: 'ההודעה לא נשלחה',
    explanation: 'WhatsApp לא הצליחה לשלוח את ההודעה.',
    action: 'אפשר לנסות שוב בעוד כמה רגעים.',
  },
}

/** Normalize a persisted/foreign category value to a known one (unknown → generic). */
export function normalizeFailureCategory(value: string | null | undefined): WhatsappErrorCategory {
  return value != null && value in FAILURE_TOOLTIP ? (value as WhatsappErrorCategory) : 'generic'
}

/** Resolve the structured tooltip copy for a failure category. */
export function failureTooltip(category: string | null | undefined): FailureTooltipCopy {
  return FAILURE_TOOLTIP[normalizeFailureCategory(category)]
}
