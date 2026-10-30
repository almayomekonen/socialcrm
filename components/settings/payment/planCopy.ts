import type { MessageKey, Translator } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

/**
 * The plan copy of `lib/plans.ts` (inclusions, tagline — the single Hebrew
 * source, unchanged) in the interface language, by exact line. Display only;
 * a line we do not know is shown as written. Prices are never in here.
 */
const LINE_KEYS: MessageKey[] = [
  'settings.payment.packages.included.i1',
  'settings.payment.packages.included.i2',
  'settings.payment.packages.included.i3',
  'settings.payment.packages.included.i4',
  'settings.payment.packages.included.i5',
  'settings.payment.packages.tagline',
]
const HEBREW = translatorFor('he')
const BY_LINE = new Map<string, MessageKey>(LINE_KEYS.map((key) => [HEBREW(key), key]))

export const planLine = (line: string, t: Translator) => (t.locale === 'he' ? line : BY_LINE.has(line) ? t(BY_LINE.get(line)!) : line)

export const planIncluded = (items: string[], t: Translator) => (t.locale === 'he' ? items : items.map((item) => planLine(item, t)))
