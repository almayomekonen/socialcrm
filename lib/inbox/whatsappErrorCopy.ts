import type { UiLocale } from '@/lib/i18n/config'
import type { MessageKey } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * Meta WhatsApp error code → rep-facing copy (catalog `inbox.failure.*` /
 * `inbox.tooltip.*`; Hebrew unless a reader passes the interface locale).
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

const CATEGORIES: readonly WhatsappErrorCategory[] = ['window_expired', 'recipient', 'account', 'generic']

const FAILURE_KEY: Record<WhatsappErrorCategory, MessageKey> = {
  window_expired: 'inbox.failure.window_expired',
  recipient: 'inbox.failure.recipient',
  account: 'inbox.failure.account',
  generic: 'inbox.failure.generic',
}

const TOOLTIP_KEYS: Record<WhatsappErrorCategory, { title: MessageKey; explanation: MessageKey; action: MessageKey }> = {
  window_expired: {
    title: 'inbox.tooltip.window_expired.title',
    explanation: 'inbox.tooltip.window_expired.explanation',
    action: 'inbox.tooltip.window_expired.action',
  },
  recipient: {
    title: 'inbox.tooltip.recipient.title',
    explanation: 'inbox.tooltip.recipient.explanation',
    action: 'inbox.tooltip.recipient.action',
  },
  account: {
    title: 'inbox.tooltip.account.title',
    explanation: 'inbox.tooltip.account.explanation',
    action: 'inbox.tooltip.account.action',
  },
  generic: {
    title: 'inbox.tooltip.generic.title',
    explanation: 'inbox.tooltip.generic.explanation',
    action: 'inbox.tooltip.generic.action',
  },
}

/** Hebrew rep-facing copy per category — what ingestion and every untranslated reader get. */
const CATEGORY_TEXT = Object.fromEntries(CATEGORIES.map((c) => [c, translatorFor('he')(FAILURE_KEY[c])])) as Record<
  WhatsappErrorCategory,
  string
>

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
export function failureTextForCategory(key: string | null | undefined, locale: UiLocale = 'he'): string | null {
  if (!key) return null
  const category = (CATEGORIES as readonly string[]).includes(key) ? (key as WhatsappErrorCategory) : 'generic'
  return translatorFor(locale)(FAILURE_KEY[category])
}

export type FailureTooltipCopy = { title: string; explanation: string; action: string }

/** Normalize a persisted/foreign category value to a known one (unknown → generic). */
export function normalizeFailureCategory(value: string | null | undefined): WhatsappErrorCategory {
  return value != null && value in TOOLTIP_KEYS ? (value as WhatsappErrorCategory) : 'generic'
}

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
export function failureTooltip(category: string | null | undefined, locale: UiLocale = 'he'): FailureTooltipCopy {
  const keys = TOOLTIP_KEYS[normalizeFailureCategory(category)]
  const t = translatorFor(locale)
  return { title: t(keys.title), explanation: t(keys.explanation), action: t(keys.action) }
}
