/**
 * Interface-language registry — the ONE list of UI locales the product knows.
 *
 * A UI locale is the language of the CRM's own chrome. It is deliberately a
 * different concept from `agencies.locale`, which is the BILLING / invoice
 * document locale: changing the interface language must never change how an
 * invoice is issued, so the two never share a column or a type.
 *
 * Adding a language: add it here, add `messages/<code>.ts` typed as `Messages`
 * (the compiler then refuses a missing key), and run `pnpm i18n:check`. No
 * component changes — components ask for keys, not languages.
 */

export const UI_LOCALES = ['he', 'en', 'ar'] as const
export type UiLocale = (typeof UI_LOCALES)[number]

/**
 * What every existing user and agency sees until someone explicitly chooses
 * otherwise. Hebrew, because that is the product they signed up to — a deploy
 * must never move an existing customer to another language as a side effect.
 */
export const LEGACY_DEFAULT_LOCALE: UiLocale = 'he'

export type TextDirection = 'rtl' | 'ltr'

/** Native names are shown in their own script, whatever the current UI language. */
export const LOCALE_META: Record<UiLocale, { nativeName: string; dir: TextDirection }> = {
  he: { nativeName: 'עברית', dir: 'rtl' },
  en: { nativeName: 'English', dir: 'ltr' },
  ar: { nativeName: 'العربية', dir: 'rtl' },
}

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === 'string' && (UI_LOCALES as readonly string[]).includes(value)
}

export function dirFor(locale: UiLocale): TextDirection {
  return LOCALE_META[locale].dir
}

export type RegionAttrs = { lang?: UiLocale; dir?: TextDirection }

/**
 * Language islands (Phase 1). `<html>` stays `he`/`rtl`: the root layout is
 * static under Cache Components, and Hebrew is still the truth for most of every
 * page. Translated regions declare the effective language; untranslated content
 * re-declares Hebrew (`untranslatedAttrs`, on the workspace `<main>`), so an
 * English user never sees Hebrew laid out left-to-right.
 *
 * For Hebrew both return NOTHING — the DOM of every Hebrew user is identical to
 * what it was before i18n existed.
 */
export function regionAttrs(locale: UiLocale): RegionAttrs {
  if (locale === LEGACY_DEFAULT_LOCALE) return {}
  return { lang: locale, dir: dirFor(locale) }
}

export function untranslatedAttrs(locale: UiLocale): RegionAttrs {
  if (locale === LEGACY_DEFAULT_LOCALE) return {}
  return { lang: LEGACY_DEFAULT_LOCALE, dir: dirFor(LEGACY_DEFAULT_LOCALE) }
}
