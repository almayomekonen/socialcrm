import { UI_LOCALES, LEGACY_DEFAULT_LOCALE, type UiLocale } from './config'
import { intlLocale, type Messages } from './translate'

/**
 * Translation-coverage rules, shared by `pnpm i18n:check` and the test suite.
 * Hebrew is the reference; every other catalog must match it exactly in shape.
 *
 * Reported per locale:
 *   missing      key in Hebrew, absent here
 *   extra        key here, absent in Hebrew
 *   shape        string where Hebrew has a plural (or the reverse)
 *   empty        blank string
 *   placeholder  `{name}` set differs from Hebrew's
 *   plural       a CLDR plural category the language uses has no form
 *   untranslated identical to Hebrew (a silent fallback), outside ALLOWED_SAME
 */

export type CoverageIssue = { locale: UiLocale; key: string; kind: string; detail?: string }

/** Strings that are legitimately the same in every language (brand / product terms). */
const ALLOWED_SAME = new Set<string>([
  // Brand names, written the same way in Hebrew and English UI.
  'common.source.whatsapp',
  'common.source.facebook',
  'common.source.instagram',
  'today.analytics.source.whatsapp',
  // Pure punctuation pattern; the words come from other keys.
  'today.greetingWithName',
])

type Leaf = string | Record<string, string>

export function flatten(tree: unknown, prefix = ''): Map<string, Leaf> {
  const out = new Map<string, Leaf>()
  for (const [k, v] of Object.entries(tree as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.set(key, v)
    else if (v && typeof v === 'object' && typeof (v as any).other === 'string') out.set(key, v as Record<string, string>)
    else if (v && typeof v === 'object') for (const [k2, v2] of flatten(v, key)) out.set(k2, v2)
  }
  return out
}

function placeholders(leaf: Leaf): string {
  const texts = typeof leaf === 'string' ? [leaf] : Object.values(leaf)
  const names = new Set<string>()
  for (const text of texts) for (const m of text.matchAll(/\{(\w+)\}/g)) names.add(m[1])
  // `count` is implicit in plural forms ("one day" needs no digit).
  if (typeof leaf !== 'string') names.delete('count')
  return [...names].sort().join(',')
}

export function checkCatalogs(catalogs: Record<UiLocale, Messages>): CoverageIssue[] {
  const issues: CoverageIssue[] = []
  const reference = flatten(catalogs[LEGACY_DEFAULT_LOCALE])

  for (const locale of UI_LOCALES) {
    const flat = flatten(catalogs[locale])
    const categories = new Intl.PluralRules(intlLocale(locale)).resolvedOptions().pluralCategories

    for (const [key, ref] of reference) {
      const leaf = flat.get(key)
      if (leaf === undefined) {
        issues.push({ locale, key, kind: 'missing' })
        continue
      }
      if (typeof leaf !== typeof ref) {
        issues.push({ locale, key, kind: 'shape' })
        continue
      }
      const texts = typeof leaf === 'string' ? [leaf] : Object.values(leaf)
      if (texts.some((s) => !s.trim())) issues.push({ locale, key, kind: 'empty' })
      if (placeholders(leaf) !== placeholders(ref)) {
        issues.push({ locale, key, kind: 'placeholder', detail: `${placeholders(leaf)} vs ${placeholders(ref)}` })
      }
      if (typeof leaf !== 'string') {
        // `other` covers any category Hebrew's own forms also leave to it.
        const missingCats = categories.filter((c) => c !== 'other' && !(c in leaf) && locale !== LEGACY_DEFAULT_LOCALE)
        if (missingCats.length) issues.push({ locale, key, kind: 'plural', detail: missingCats.join(',') })
      }
      if (locale !== LEGACY_DEFAULT_LOCALE && !ALLOWED_SAME.has(key) && JSON.stringify(leaf) === JSON.stringify(ref)) {
        issues.push({ locale, key, kind: 'untranslated' })
      }
    }
    for (const key of flat.keys()) if (!reference.has(key)) issues.push({ locale, key, kind: 'extra' })
  }
  return issues
}

/**
 * Keys referenced in source as string literals. Namespaces come from the
 * catalog itself, so a new namespace is scanned without editing this file.
 * `roles.*` is looked up by role code, so it counts as used.
 */
export function unusedKeys(catalog: Messages, sources: string[]): string[] {
  const used = new Set<string>()
  const keyRx = new RegExp(`['"\`]((?:${Object.keys(catalog).join('|')})\\.[\\w.]+)['"\`]`, 'g')
  for (const src of sources) for (const m of src.matchAll(keyRx)) used.add(m[1])
  return [...flatten(catalog).keys()].filter((key) => !used.has(key) && !key.startsWith('roles.'))
}
