/**
 * Customer-facing WhatsApp text must read as natural conversation.
 * Clause dashes are rewritten; phones, URLs, emails, and IDs are left intact.
 */

const DASH_RE = /[\u002D\u2010\u2011\u2013\u2014\u2212]/
const DASH_GLOBAL_RE = /[\u002D\u2010\u2011\u2013\u2014\u2212]/g

const URL_RE = /https?:\/\/[^\s]+/gi
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const WAMID_RE = /wamid\.[A-Za-z0-9=._-]+/g
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g

const MARK_OPEN = '\uE000'
const MARK_CLOSE = '\uE001'

function protectSpans(text: string): { masked: string; tokens: string[] } {
  const tokens: string[] = []
  const mask = (re: RegExp, input: string): string =>
    input.replace(re, (m) => {
      const i = tokens.length
      tokens.push(m)
      return `${MARK_OPEN}${i}${MARK_CLOSE}`
    })
  let masked = text
  masked = mask(URL_RE, masked)
  masked = mask(EMAIL_RE, masked)
  masked = mask(UUID_RE, masked)
  masked = mask(WAMID_RE, masked)
  masked = mask(PHONE_RE, masked)
  return { masked, tokens }
}

function restoreSpans(masked: string, tokens: string[]): string {
  return masked.replace(new RegExp(`${MARK_OPEN}(\\d+)${MARK_CLOSE}`, 'g'), (_, n) => tokens[Number(n)] ?? '')
}

const ANY_DASH = '[\u002D\u2010\u2011\u2013\u2014\u2212]'

function rewriteNaturalLanguageDashes(text: string): string {
  let out = text
  // Spaced clause dashes → comma. Require whitespace so ל-SocialCRM is not split.
  out = out.replace(new RegExp(`\\s+${ANY_DASH}\\s+`, 'g'), ', ')
  // Glued Hebrew clause dash: לחזור—ככה → לחזור, ככה
  out = out.replace(new RegExp(`(?<=[\\u0590-\\u05FF])${ANY_DASH}(?=[\\u0590-\\u05FF])`, 'g'), ', ')
  // Hebrew prefix glued to a Latin token: ל-SocialCRM / ל‑SocialCRM → לSocialCRM
  out = out.replace(new RegExp(`(?<=[\\u0590-\\u05FF])${ANY_DASH}(?=[A-Za-z])`, 'g'), '')
  // Remaining Latin compounds: well-known → well known (never concatenate).
  out = out.replace(new RegExp(`(?<=[A-Za-z])${ANY_DASH}(?=[A-Za-z])`, 'g'), ' ')
  // Any leftover unprotected dash becomes a comma clause break.
  out = out.replace(DASH_GLOBAL_RE, ', ')
  out = out.replace(/\s+,/g, ',')
  out = out.replace(/,(?=[^\s])/g, ', ')
  out = out.replace(/[ \t]+/g, ' ')
  out = out.replace(/,(?:\s*,)+/g, ',')
  return out.trim()
}

export function stripProtectedCustomerFacingSpans(text: string): string {
  return protectSpans(text).masked.replace(new RegExp(`${MARK_OPEN}\\d+${MARK_CLOSE}`, 'g'), ' ')
}

export function hasCustomerFacingDash(text: string): boolean {
  return DASH_RE.test(stripProtectedCustomerFacingSpans(text))
}

export function normalizeCustomerFacingText(text: string): string {
  const raw = (text ?? '').trim()
  if (!raw) return ''
  const { masked, tokens } = protectSpans(raw)
  const rewritten = rewriteNaturalLanguageDashes(masked)
  return restoreSpans(rewritten, tokens).replace(/[ \t]+/g, ' ').trim()
}

/** Last gate before a customer-facing send. Protected IDs/URLs may still contain dashes. */
export function finalizeCustomerFacingText(text: string): string {
  const out = normalizeCustomerFacingText(text)
  if (hasCustomerFacingDash(out)) {
    const { masked, tokens } = protectSpans(out)
    return restoreSpans(rewriteNaturalLanguageDashes(masked), tokens).replace(/[ \t]+/g, ' ').trim()
  }
  return out
}
