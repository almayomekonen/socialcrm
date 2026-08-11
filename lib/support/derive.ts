import { isSupportCategory, type SupportCategory } from './vocabulary'
import type { SupportContext } from './supportContext'

/**
 * Fields the CUSTOMER is never asked for.
 *
 * A person whose WhatsApp just stopped working should not have to write a
 * subject line and pick a category before they can tell us. Both are derived
 * here, on the server, from what they already said or from what SocialCRM
 * already resolved.
 *
 * DETERMINISTIC AND BOUNDED, never AI: the same body always yields the same
 * subject, the result always fits the column, and nothing is invented. A
 * generated summary would be a fact we authored about the customer's problem,
 * which is exactly what the Truth laws forbid.
 *
 * This lives on the server, not the client: the browser sending a subject would
 * be the client doing the server's job, and a derived value the client controls
 * is not derived at all.
 */

/** Comfortably under the column's 200, and short enough to scan in a list. */
export const SUBJECT_DERIVED_MAX = 80

/** Shown when there is nothing to derive from — never an empty subject. */
export const SUBJECT_FALLBACK = 'פנייה חדשה'

/**
 * The first line of what the customer wrote, collapsed and cut at a word
 * boundary.
 *
 * The first line is the right choice because people lead with the problem:
 * "הוואטסאפ לא מתחבר" then the detail underneath. Taking it verbatim also means
 * the subject can never misrepresent them — it IS their words.
 */
export function deriveSubject(body: string): string {
  // Collapse every run of whitespace (including newlines and tabs) to a single
  // space, so the derivation cannot be skewed by formatting.
  const firstLine = (body ?? '').split(/\r?\n/).find((l) => l.trim().length > 0) ?? ''
  const collapsed = firstLine.replace(/\s+/g, ' ').trim()

  if (collapsed.length === 0) return SUBJECT_FALLBACK
  if (collapsed.length <= SUBJECT_DERIVED_MAX) return collapsed

  // Cut at the last space inside the budget so a word is never sliced in half.
  const window = collapsed.slice(0, SUBJECT_DERIVED_MAX)
  const lastSpace = window.lastIndexOf(' ')

  // An unbroken token longer than the budget has no boundary to cut on, so it
  // is hard-cut. Rare, and better than overflowing the column.
  if (lastSpace <= 0) return window

  return window.slice(0, lastSpace)
}

/**
 * The category, decided by the system rather than the customer.
 *
 * With a resolved context, SocialCRM already knows the area better than the
 * person reporting it. Without one, `other` is the honest answer — and since a
 * single support owner reads the body anyway, asking would have bought nothing.
 */
export function deriveCategory(context: SupportContext | null): SupportCategory {
  const fromContext = context?.category
  return isSupportCategory(fromContext) ? fromContext : 'other'
}
