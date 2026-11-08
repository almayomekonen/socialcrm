import { createHmac, timingSafeEqual } from 'crypto'

/**
 * The purchase link sent in WhatsApp. The page behind it needs a logged-in
 * session and buys only for THAT session's agency, so the link carries no
 * authority. The signed token only lets the page say "this link belongs to
 * another account" instead of selling to the wrong one. CREDITS_LINK_SECRET is a
 * dedicated secret (no fallback to a platform secret); unset, the link is the
 * plain session-scoped page.
 */

const ORIGIN = 'https://getsocialcrm.com'
const PATH = '/settings/update_payment'
const TTL_MS = 30 * 86_400_000

const secret = () => process.env.CREDITS_LINK_SECRET?.trim() || null
const sign = (s: string, payload: string) => createHmac('sha256', s).update(`credits-link:${payload}`).digest('base64url')

export function creditPurchaseUrl(agencyId: number, nowMs = Date.now()): string {
  const s = secret()
  if (!s) return `${ORIGIN}${PATH}`
  const payload = `${agencyId}.${nowMs + TTL_MS}`
  return `${ORIGIN}${PATH}?credits=${payload}.${sign(s, payload)}`
}

/** The agency a genuine, unexpired token names; null for anything else. */
export function purchaseLinkAgency(token: unknown, nowMs = Date.now()): number | null {
  const s = secret()
  if (!s || typeof token !== 'string') return null
  const m = /^(\d+)\.(\d+)\.([\w-]+)$/.exec(token)
  if (!m || Number(m[2]) < nowMs) return null
  const expected = Buffer.from(sign(s, `${m[1]}.${m[2]}`))
  const given = Buffer.from(m[3])
  return expected.length === given.length && timingSafeEqual(expected, given) ? Number(m[1]) : null
}
