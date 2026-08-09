/**
 * Quote-template validation — pure, and the SAME rules the database enforces.
 *
 * Every bound below mirrors a CHECK constraint from
 * migrations/20260809000002. That duplication is deliberate and one-directional:
 * the database is the authority and cannot be bypassed, while this layer exists
 * so a bad payload comes back as a Hebrew sentence instead of a raw `23514`.
 * When a constraint changes, this file changes with it — the conformance is
 * pinned by test, not by memory.
 *
 * Client-side validation is a convenience and is never trusted: the Server
 * Action runs this before it writes, and the constraints run regardless.
 *
 * Pure and I/O-free, so the editor can validate as the user types with the same
 * code the server will apply.
 */

export type QuoteTemplateItemDraft = {
  title: string
  description: string
  quantity: number
  unitPrice: number
  discount: number
  isOptional: boolean
}

export type QuoteTemplateDraft = {
  name: string
  title: string
  introText: string
  termsText: string
  validityDays: number
  items: QuoteTemplateItemDraft[]
}

export type QuoteTemplateIssue =
  | 'name_required'
  | 'name_too_long'
  | 'title_too_long'
  | 'validity_invalid'
  | 'items_required'
  | 'too_many_items'
  | 'item_title_required'
  | 'item_title_too_long'
  | 'item_quantity_invalid'
  | 'item_price_invalid'
  | 'item_discount_invalid'

/** Mirrors the DB: `validityDays` CHECK (>= 1 AND <= 90). */
export const MIN_VALIDITY_DAYS = 1
export const MAX_VALIDITY_DAYS = 90
export const MAX_NAME_LENGTH = 120
export const MAX_TITLE_LENGTH = 200
export const MAX_ITEM_TITLE_LENGTH = 120

/**
 * A ceiling with no DB counterpart. It exists so a paste accident cannot create
 * a template that renders as an unreadable wall on a customer's quote — a
 * product bound, not an integrity one, which is why it lives only here.
 */
export const MAX_ITEMS = 50

/**
 * At least one item is required, and this is a real invariant rather than
 * tidiness: `getQuoteTemplateSystem` returns null for an item-less template, so
 * one saved empty would be silently unusable — a picker entry that produces
 * nothing. Refusing at the boundary is what keeps "listed" and "usable" the
 * same set.
 */
export const MIN_ITEMS = 1

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function validateQuoteTemplateItem(item: QuoteTemplateItemDraft): QuoteTemplateIssue | null {
  const title = (item.title ?? '').trim()
  if (!title) return 'item_title_required'
  if (title.length > MAX_ITEM_TITLE_LENGTH) return 'item_title_too_long'
  // Mirrors CHECK (quantity > 0). Zero is not "free", it is a line that should
  // not exist.
  if (!isNum(item.quantity) || item.quantity <= 0) return 'item_quantity_invalid'
  // Mirrors CHECK ("unitPrice" >= 0). Zero IS meaningful — an included extra.
  if (!isNum(item.unitPrice) || item.unitPrice < 0) return 'item_price_invalid'
  if (!isNum(item.discount) || item.discount < 0) return 'item_discount_invalid'
  return null
}

export function validateQuoteTemplateDraft(draft: QuoteTemplateDraft): QuoteTemplateIssue | null {
  const name = (draft.name ?? '').trim()
  if (!name) return 'name_required'
  if (name.length > MAX_NAME_LENGTH) return 'name_too_long'
  if ((draft.title ?? '').trim().length > MAX_TITLE_LENGTH) return 'title_too_long'

  if (
    !isNum(draft.validityDays) ||
    !Number.isInteger(draft.validityDays) ||
    draft.validityDays < MIN_VALIDITY_DAYS ||
    draft.validityDays > MAX_VALIDITY_DAYS
  ) {
    return 'validity_invalid'
  }

  const items = draft.items ?? []
  if (items.length < MIN_ITEMS) return 'items_required'
  if (items.length > MAX_ITEMS) return 'too_many_items'

  for (const item of items) {
    const issue = validateQuoteTemplateItem(item)
    if (issue) return issue
  }
  return null
}

/**
 * Line numbers, assigned rather than accepted.
 *
 * Ordering is the array's, renumbered densely from 1. Taking a client-supplied
 * `lineNumber` would let a duplicate or a gap reach the unique index — a
 * `23505` for something the caller never chose. The UI reorders by moving array
 * entries; the numbers are this function's business.
 */
export function withDenseLineNumbers<T>(items: readonly T[]): Array<T & { lineNumber: number }> {
  return items.map((item, i) => ({ ...item, lineNumber: i + 1 }))
}
