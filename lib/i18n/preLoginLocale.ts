import { LEGACY_DEFAULT_LOCALE, isUiLocale, regionAttrs, type RegionAttrs, type UiLocale } from './config'

/**
 * The interface language BEFORE sign-in (Phase F4).
 *
 * There is no user on `/auth`, `/auth/register`, `/activate`, `/oauth/consent`
 * (which read no locale preference) or in the root `ChunkReloader`, so the
 * signed-in app leaves a display hint behind: a `ui_locale` cookie, written by
 * the browser ONLY when a signed-in user's resolved interface language is not
 * Hebrew — i.e. only for pilot users, since resolution is already gated by
 * `UI_LOCALE_ENABLED` + the allowlist — and removed when it resolves to Hebrew.
 * It holds `en` / `ar` and nothing else: no id, no session, no secret. Not
 * HttpOnly on purpose (the browser writes it); it is never used for auth.
 *
 * Readers honour it only while `UI_LOCALE_ENABLED` is on (the kill switch).
 * Missing / invalid / flag off → Hebrew. No Accept-Language, no detection.
 */

export const UI_LOCALE_COOKIE = 'ui_locale'

/** One year. Refreshed on every signed-in page load for a pilot user. */
export const UI_LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** Pure: the pre-login locale for a raw cookie value under the rollout switch. */
export function preLoginLocaleFrom(raw: string | null | undefined, enabled: boolean): UiLocale {
  if (!enabled) return LEGACY_DEFAULT_LOCALE
  return isUiLocale(raw) ? raw : LEGACY_DEFAULT_LOCALE
}

/** The cookie's value in a `document.cookie` string, or null. */
export function readUiLocaleCookie(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === UI_LOCALE_COOKIE) return rest.join('=')
  }
  return null
}

/**
 * The `document.cookie` assignment that brings the hint in line with the
 * signed-in user's resolved locale, or null when nothing must be written:
 * a Hebrew user without the cookie gets NO write at all (non-pilot behaviour is
 * unchanged), a Hebrew user with one gets it removed.
 */
export function uiLocaleCookieWrite(locale: UiLocale, current: string | null, secure: boolean): string | null {
  const tail = `; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`
  if (locale === LEGACY_DEFAULT_LOCALE) return current === null ? null : `${UI_LOCALE_COOKIE}=${tail}; Max-Age=0`
  return `${UI_LOCALE_COOKIE}=${locale}${tail}; Max-Age=${UI_LOCALE_COOKIE_MAX_AGE}`
}

/** Browser side effect, called from the signed-in app's language provider. */
export function syncUiLocaleCookie(locale: UiLocale): void {
  if (typeof document === 'undefined') return
  const write = uiLocaleCookieWrite(locale, readUiLocaleCookie(document.cookie), location.protocol === 'https:')
  if (write) document.cookie = write
}

/**
 * For an element that hard-codes `dir='rtl'` today: Hebrew keeps exactly that
 * attribute (byte-identical markup), other languages declare their region.
 */
export function rtlOrRegionAttrs(locale: UiLocale): RegionAttrs {
  return locale === LEGACY_DEFAULT_LOCALE ? { dir: 'rtl' } : regionAttrs(locale)
}
