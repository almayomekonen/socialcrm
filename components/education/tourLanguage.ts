'use client'

import { useEffect } from 'react'
import type { Translator } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * The interface language of the Driver.js popovers (Phase E6).
 *
 * Driver.js draws its popover straight into `<body>`, outside every React
 * tree and language island — the same position as the toast container, so it
 * gets the language the same way the toast defaults do: the education island
 * (inside the I18nProvider) pushes its translator here and restores Hebrew on
 * unmount. `runTour` reads it when it builds a popover, never earlier, so a
 * language switch applies to the next tour. Hebrew is the default: a tour
 * started outside the island is exactly what it was before.
 */
const HEBREW = translatorFor('he')
let current: Translator = HEBREW

export function tourTranslator(): Translator {
  return current
}

export function useTourLanguage(t: Translator): void {
  useEffect(() => {
    if (t.locale === 'he') return
    current = t
    return () => {
      current = HEBREW
    }
  }, [t])
}
