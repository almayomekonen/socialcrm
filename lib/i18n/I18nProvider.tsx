'use client'

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { LEGACY_DEFAULT_LOCALE, regionAttrs, type RegionAttrs, type UiLocale } from './config'
import { createTranslator, type Translator } from './translate'
import { CATALOGS } from './messages'
import { resetToastDefaults, setToastDefaults } from '@/lib/toast'

const HEBREW = createTranslator(LEGACY_DEFAULT_LOCALE, CATALOGS[LEGACY_DEFAULT_LOCALE])
const I18nContext = createContext<Translator | null>(null)

/**
 * Client access to the request's interface language. `locale` arrives as a
 * prop resolved on the server, so the first client render uses exactly what
 * the server rendered — there is no client-side detection to disagree with.
 */
export function I18nProvider({ locale, children }: { locale: UiLocale; children: ReactNode }) {
  const t = useMemo(() => createTranslator(locale, CATALOGS[locale]), [locale])

  // The toast container renders outside this provider (root layout), so its
  // no-message defaults are pushed to it. Hebrew is already its built-in text.
  useEffect(() => {
    if (locale === LEGACY_DEFAULT_LOCALE) return
    setToastDefaults({
      success: t('common.toast.success'),
      error: t('common.toast.error'),
      loading: t('common.toast.loading'),
      ban: t('common.toast.ban'),
      message: t('common.toast.message'),
      pro: t('common.toast.pro'),
    })
    return resetToastDefaults
  }, [locale, t])

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
