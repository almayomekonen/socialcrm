import type { UiLocale } from './config'
import type { he } from './messages/he'

/**
 * Plural message: one string per CLDR plural category the language uses.
 * `other` is mandatory — it is what `Intl.PluralRules` falls back to and what
 * the coverage check requires. Hebrew uses one/two/other; Arabic uses all six.
 */
export type PluralForms = {
  other: string
  zero?: string
  one?: string
  two?: string
  few?: string
  many?: string
}

/**
 * Every locale file must have exactly Hebrew's shape: same keys, strings where
 * Hebrew has strings, plural objects where Hebrew has plural objects. Hebrew is
 * the source of truth because it is the language the product is written in.
 */
type Widen<T> = T extends string ? string : T extends { other: string } ? PluralForms : { [K in keyof T]: Widen<T[K]> }
export type Messages = Widen<typeof he>

type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string | { other: string } ? `${P}${K}` : Paths<T[K], `${P}${K}.`>
}[keyof T & string]
export type MessageKey = Paths<typeof he>

export type MessageParams = Record<string, string | number>

/**
 * The `Intl` locale used for numbers inside UI messages.
 *
 * Arabic uses Latin digits (`nu-latn`): the CRM's own data — phone numbers,
 * amounts, ids — is stored and shown in Latin digits everywhere, and a chrome
 * that says "٣ أيام" beside a table of "3" reads as two systems. A per-agency
 * numbering choice can replace this if customers ask for it.
 */
export function intlLocale(locale: UiLocale): string {
  return locale === 'ar' ? 'ar-u-nu-latn' : locale
}

function lookup(messages: Messages, key: string): string | PluralForms | undefined {
  let node: any = messages
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined
    node = node[part]
  }
  return typeof node === 'string' || (node && typeof node.other === 'string') ? node : undefined
}

export type Translator = ((key: MessageKey, params?: MessageParams) => string) & { locale: UiLocale }

/**
 * Build `t(key, params)` for one locale.
 *
 * - `{name}` placeholders are replaced from `params`; numbers are formatted for
 *   the locale. Whole sentences live in the catalog — callers never glue
 *   translated fragments together.
 * - A plural message picks its form from `params.count` via `Intl.PluralRules`.
 * - A missing key returns the key itself, so a gap is visible in the UI and in
 *   tests instead of silently rendering another language. The type system and
 *   `pnpm i18n:check` keep that from shipping.
 */
export function createTranslator(locale: UiLocale, messages: Messages): Translator {
  const tag = intlLocale(locale)
  const plurals = new Intl.PluralRules(tag)
  const numbers = new Intl.NumberFormat(tag)

  const t = ((key: MessageKey, params?: MessageParams) => {
    const entry = lookup(messages, key)
    if (entry === undefined) return key
    let text: string
    if (typeof entry === 'string') {
      text = entry
    } else {
      const count = Number(params?.count ?? 0)
      text = entry[plurals.select(count)] ?? entry.other
    }
    if (!params) return text
    return text.replace(/\{(\w+)\}/g, (match, name) => {
      const value = params[name]
      if (value === undefined) return match
      return typeof value === 'number' ? numbers.format(value) : value
    })
  }) as Translator
  t.locale = locale
  return t
}
