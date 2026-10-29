import type { UiLocale } from './config'
import { createTranslator, type Translator } from './translate'
import { CATALOGS } from './messages'

const cache = new Map<UiLocale, Translator>()

/**
 * One translator per locale, built once. Server producers (labels, durations,
 * greetings) take a plain `locale` and resolve it here, so the locale itself is
 * what crosses function boundaries — never a translator object.
 */
export function translatorFor(locale: UiLocale): Translator {
  let t = cache.get(locale)
  if (!t) {
    t = createTranslator(locale, CATALOGS[locale])
    cache.set(locale, t)
  }
  return t
}
