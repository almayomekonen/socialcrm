/**
 * Validation for the "return to the page the user started from" path carried
 * through the Google Calendar / Drive OAuth round-trip. The only thing that
 * matters here is the open-redirect guard: a value that is not a same-origin
 * relative path must never become a redirect target.
 */

export const DEFAULT_RETURN = '/dashboard'

/**
 * Returns `raw` only if it is a safe same-origin relative path:
 *  - a single leading slash (so it resolves against our own origin),
 *  - not protocol-relative (`//host`) and not a backslash trick (`/\host`),
 *  - free of control characters (cookie-header safety).
 * Anything else → `null` (callers fall back to DEFAULT_RETURN).
 */
export function sanitizeReturnTo(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//')) return null
  if (raw.startsWith('/\\')) return null
  if (/[\u0000-\u001f]/.test(raw)) return null
  return raw
}
