import { LEGACY_DEFAULT_LOCALE, isUiLocale, type UiLocale } from './config'

export type LocaleSource = 'user' | 'agency' | 'default'

export type ResolvedLocale = { locale: UiLocale; source: LocaleSource }

/**
 * The single locale-resolution rule. Pure and deterministic: the server runs
 * it once per request and passes the RESULT down, so server HTML and client
 * hydration can never disagree about the language.
 *
 * Precedence:
 *   1. the user's explicit personal choice (`users.uiLocale`)
 *   2. the agency default set by an administrator (`agencies.uiLocale`)
 *   3. Hebrew — what every existing account has always seen
 *
 * Outside the rollout (`enabled === false`) stored values are ignored entirely
 * and everyone gets Hebrew, so a stale row can never leak a language to an
 * agency that is not in the pilot.
 *
 * Deliberately absent: browser `Accept-Language` and any regional signal. Every
 * user in the pilot is an existing Hebrew user; switching them on a browser
 * header would be exactly the automatic language change this rollout forbids.
 * Detection for brand-new international sign-ups is a later phase.
 *
 * An unrecognised stored value (a removed locale, a hand-edited row) is treated
 * as "no preference" and falls through, never as an error.
 */
export function resolveUiLocale({
  enabled,
  userLocale,
  agencyLocale,
}: {
  enabled: boolean
  userLocale: unknown
  agencyLocale: unknown
}): ResolvedLocale {
  if (!enabled) return { locale: LEGACY_DEFAULT_LOCALE, source: 'default' }
  if (isUiLocale(userLocale)) return { locale: userLocale, source: 'user' }
  if (isUiLocale(agencyLocale)) return { locale: agencyLocale, source: 'agency' }
  return { locale: LEGACY_DEFAULT_LOCALE, source: 'default' }
}

/** The language the agency default resolves to — what "use the business default" means. */
export function agencyDefaultLocale(agencyLocale: unknown): UiLocale {
  return isUiLocale(agencyLocale) ? agencyLocale : LEGACY_DEFAULT_LOCALE
}
