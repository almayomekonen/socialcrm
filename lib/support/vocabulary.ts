/**
 * The closed vocabularies of first-party product support.
 *
 * The one relationship this domain models is SocialCRM customer <-> SocialCRM
 * platform support. There is no third party, no agency-to-agency support, and
 * no concept of an agency's own customers anywhere in these unions.
 *
 * Every one of these is a const tuple plus a derived union, so a value added
 * here without a matching entry in ./copy.ts is a compile error rather than a
 * blank chip in production — the same discipline as the connections copy maps.
 */

export const SUPPORT_CATEGORIES = [
  'leads',
  'whatsapp',
  'meta',
  'automations',
  'ai',
  'billing',
  'account',
  'integrations',
  'other',
] as const
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]

/**
 * The categories the knowledge base has sections for. `other` is a form escape
 * hatch — a request can be filed under it, but there is nothing to read about
 * "other", so it must never render as a guide tile.
 */
export const GUIDE_CATEGORIES: readonly SupportCategory[] = SUPPORT_CATEGORIES.filter(
  (c) => c !== 'other',
)

export const SUPPORT_STATUSES = ['open', 'in_progress', 'waiting_for_customer', 'resolved'] as const
export type SupportStatus = (typeof SUPPORT_STATUSES)[number]

/** Which tile the customer came from. Selects copy only — never authorization. */
export const SUPPORT_KINDS = ['question', 'problem'] as const
export type SupportKind = (typeof SUPPORT_KINDS)[number]

/**
 * Who wrote a message. Exactly three parties exist in this product: the
 * SocialCRM customer, SocialCRM support, and the platform itself.
 */
export const SUPPORT_AUTHOR_KINDS = ['customer', 'support', 'system'] as const
export type SupportAuthorKind = (typeof SUPPORT_AUTHOR_KINDS)[number]

export type SupportErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid_subject'
  | 'invalid_body'
  | 'invalid_category'
  | 'rate_limited'

export function isSupportCategory(value: unknown): value is SupportCategory {
  return typeof value === 'string' && (SUPPORT_CATEGORIES as readonly string[]).includes(value)
}

export function isSupportKind(value: unknown): value is SupportKind {
  return typeof value === 'string' && (SUPPORT_KINDS as readonly string[]).includes(value)
}

export function isSupportStatus(value: unknown): value is SupportStatus {
  return typeof value === 'string' && (SUPPORT_STATUSES as readonly string[]).includes(value)
}

/** Unknown `?kind=` values degrade to a question rather than rejecting the page. */
export function coerceSupportKind(value: unknown): SupportKind {
  return isSupportKind(value) ? value : 'question'
}
