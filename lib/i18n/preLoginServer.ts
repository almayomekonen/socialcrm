import 'server-only'
import { cookies } from 'next/headers'
import { isUiLocaleEnabled } from '@/lib/flags/uiLocaleFlags'
import { UI_LOCALE_COOKIE, preLoginLocaleFrom } from './preLoginLocale'
import type { UiLocale } from './config'

/**
 * The pre-login interface language for this request (Phase F4): the
 * `ui_locale` hint the signed-in app left (lib/i18n/preLoginLocale.ts), honoured
 * only while `UI_LOCALE_ENABLED` is on. Reads a request cookie, so it must be
 * called from a page that already renders at request time inside its layout's
 * Suspense boundary (every caller is: they read the session, searchParams or
 * `connection()`), never from a layout's static shell.
 */
export async function getPreLoginLocale(): Promise<UiLocale> {
  if (!isUiLocaleEnabled()) return 'he'
  return preLoginLocaleFrom((await cookies()).get(UI_LOCALE_COOKIE)?.value, true)
}
