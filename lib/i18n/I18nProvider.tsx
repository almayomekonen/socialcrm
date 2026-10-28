'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { LEGACY_DEFAULT_LOCALE, regionAttrs, type RegionAttrs, type UiLocale } from './config'
import { createTranslator, type Translator } from './translate'
import { CATALOGS } from './messages'

const HEBREW = createTranslator(LEGACY_DEFAULT_LOCALE, CATALOGS[LEGACY_DEFAULT_LOCALE])
const I18nContext = createContext<Translator | null>(null)

/**
 * Client access to the request's interface language. `locale` arrives as a
 * prop resolved on the server, so the first client render uses exactly what
 * the server rendered — there is no client-side detection to disagree with.
 */
export function I18nProvider({ locale, children }: { locale: UiLocale; children: ReactNode }) {
  const t = useMemo(() => createTranslator(locale, CATALOGS[locale]), [locale])
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>
}

/** Outside a provider (tests, static pages) this is Hebrew — the existing UI, unchanged. */
export function useT(): Translator {
  return useContext(I18nContext) ?? HEBREW
}

/** `lang`/`dir` for a TRANSLATED region, spread onto its existing element. See `regionAttrs`. */
export function useRegionAttrs(): RegionAttrs {
  return regionAttrs(useT().locale)
}
