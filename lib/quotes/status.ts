import { businessDateString } from '@/lib/today/time'

/**
 * The quote lifecycle — the vocabulary, and the one derived question.
 *
 * SINGLE AXIS, deliberately. `bill_invoices` carries two (a legal `docState`
 * and a money `fulfillState`) because an invoice is a claim on money. A quote
 * is an offer: it is being written, it is out, or it has an answer. There is no
 * outstanding amount to project.
 *
 * Values are PERSISTED (the `sales_quotes.status` CHECK) and therefore
 * append-only: a value may be added deliberately, never renamed or removed.
 *
 * Pure. No I/O, no knex — so a Client Component can import it without dragging
 * the data layer into the browser bundle (the `lib/billing/totals.ts` rule).
 */

export const QUOTE_STATUSES = ['draft', 'ready', 'sent', 'accepted', 'declined', 'expired'] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

/** Still being written; content and totals are mutable. */
export const EDITABLE_QUOTE_STATUSES: readonly QuoteStatus[] = ['draft']

/**
 * Out with the customer and awaiting an answer. What "does this lead already
 * have a quote in flight?" means — the question a future automation condition
 * will ask, and the reason this set is named rather than inlined.
 */
export const OPEN_QUOTE_STATUSES: readonly QuoteStatus[] = ['ready', 'sent']

/** The customer answered. Terminal for the offer itself. */
export const DECIDED_QUOTE_STATUSES: readonly QuoteStatus[] = ['accepted', 'declined']

export function isQuoteStatus(value: unknown): value is QuoteStatus {
  return typeof value === 'string' && (QUOTE_STATUSES as readonly string[]).includes(value)
}

/**
 * Whether a quote's validity window has passed.
 *
 * DERIVED, not stored — v1 writes no `expired` row. The status value exists so
 * that materialising it later (when an automation needs to fire on expiry) is a
 * write rather than a migration.
 *
 * Only a SENT quote can expire. A draft has not been offered to anyone, and a
 * decided quote already has an answer that expiry cannot overrule.
 *
 * The comparison is between CALENDAR DATES in the business timezone, never
 * between timestamps: "valid until the 23rd" means the whole of the 23rd,
 * wherever the rep's browser happens to be. A quote expiring today is NOT yet
 * expired — strict `<` is the difference between "you have until the 23rd" and
 * "you had until the 22nd".
 */
export function isQuoteExpired(
  quote: { status: QuoteStatus; expiresAt: string | null },
  nowMs: number,
): boolean {
  if (quote.status !== 'sent') return false
  if (!quote.expiresAt) return false
  return quote.expiresAt.slice(0, 10) < businessDateString(nowMs)
}

/**
 * The status to SHOW, with expiry folded in. The stored value stays `sent`;
 * this is the read-time view of it.
 */
export function effectiveQuoteStatus(
  quote: { status: QuoteStatus; expiresAt: string | null },
  nowMs: number,
): QuoteStatus {
  return isQuoteExpired(quote, nowMs) ? 'expired' : quote.status
}

/**
 * The concrete expiry date for a quote created now with `validityDays` of
 * validity, as `YYYY-MM-DD`.
 *
 * Resolved from the business calendar rather than by adding milliseconds to a
 * timestamp: a 14-day window that crosses a DST boundary is still 14 calendar
 * days, and a date column has no time to shift.
 */
export function expiryDateFrom(nowMs: number, validityDays: number): string {
  const days = Number.isFinite(validityDays) && validityDays > 0 ? Math.floor(validityDays) : 0
  // Anchored at business NOON so the +N-day walk can never cross a day boundary
  // through a 23-hour DST day.
  const anchor = new Date(`${businessDateString(nowMs)}T12:00:00Z`).getTime()
  return businessDateString(anchor + days * 86_400_000, 'UTC')
}
