'use client'

import { useEffect } from 'react'
import { regionAttrs, type RegionAttrs } from './i18n/config'
import type { Translator } from './i18n/translate'

/**
 * The Pro toast's own chrome in the interface language (Phase E6): its default
 * call-to-action and the region it declares — the toast renders in the root
 * layout, outside every language island. `null` = Hebrew, exactly as before.
 *
 * Pushed by the DESKTOP shell only (`Topbar`): every desktop caller of
 * `proToast` passes a title and body in the interface language, while the
 * phone workspace still has Hebrew callers (Phase F), whose toast stays Hebrew
 * whole. Its own module so `lib/toast` (often mocked in tests) keeps its exports.
 */
export type ProToastChrome = { cta: string; attrs: RegionAttrs }

let proChrome: ProToastChrome | null = null

export function proToastChrome(): ProToastChrome | null {
  return proChrome
}

export function useProToastLanguage(t: Translator): void {
  useEffect(() => {
    if (t.locale === 'he') return
    proChrome = { cta: t('common.toast.proCta'), attrs: regionAttrs(t.locale) }
    return () => {
      proChrome = null
    }
  }, [t])
}
