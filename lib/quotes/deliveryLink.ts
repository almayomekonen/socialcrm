import { createHash, randomBytes } from 'node:crypto'

/**
 * The customer's link to one delivered quote. A bearer capability, so it is
 * unguessable (256 bits), stored only as a hash, and bound to one delivery of
 * one version of one PDF. It carries no CRM identifier, and it travels in the URL
 * fragment so no server log ever records it.
 */

export const QUOTE_LINK_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
export const QUOTE_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000
const QUOTE_LINK_MAX_MS = 180 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A quote with a validity date: the link lives through the end of that date
 * (UTC midnight after it, which is a couple of hours after Israel's), capped at
 * 180 days. Without one: 30 days.
 */
export function quoteLinkExpiry(expiresOn: string | null, nowMs: number): Date {
  const end = expiresOn ? Date.parse(`${expiresOn}T00:00:00Z`) + DAY_MS : NaN
  return new Date(Number.isFinite(end) ? Math.min(end, nowMs + QUOTE_LINK_MAX_MS) : nowMs + QUOTE_LINK_TTL_MS)
}

export const newQuoteLinkToken = () => randomBytes(32).toString('base64url')
export const hashQuoteLinkToken = (token: string) => createHash('sha256').update(token).digest('hex')
/** In the fragment, so the token is never sent with the page request (see app/api/q/route.ts). */
export const quoteLinkPath = (token: string) => `/api/q#${token}`

/** The customer-facing page around the link. */
export const QUOTE_LINK_PAGE_COPY = {
  title: 'הצעת מחיר',
  opening: 'פותחים את הצעת המחיר...',
  failed: 'הקישור לא תקין, פג תוקפו או בוטל. אפשר לבקש קישור חדש מהעסק.',
  noScript: 'כדי לפתוח את הצעת המחיר צריך לאפשר JavaScript בדפדפן.',
} as const
