import type { UiLocale } from '@/lib/i18n/config'
import { intlLocale } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'
import { BUSINESS_TZ } from '@/lib/today/constants'

/**
 * Server-side relative time for the mobile conversation list.
 *
 * Computed on the SERVER against an injected `nowMs` and shipped as a string,
 * so no row reads a clock in the browser — the same rule the lead cards follow
 * (architecture-rules.md §11). Pure and trivially testable.
 *
 * Deliberately coarse: a conversation list needs "how stale is this", not a
 * precise duration. Anything past a week shows a date instead of a countdown.
 */
export function relativeTimeHe(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''

  const diffMs = nowMs - then
  if (diffMs < 0) return 'עכשיו'

  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return 'עכשיו'
  if (minutes === 1) return 'לפני דקה'
  if (minutes < 60) return `לפני ${minutes} דקות`

  const hours = Math.floor(minutes / 60)
  if (hours === 1) return 'לפני שעה'
  if (hours < 24) return `לפני ${hours} שעות`

  const days = Math.floor(hours / 24)
  if (days === 1) return 'אתמול'
  if (days < 7) return `לפני ${days} ימים`

  // Past a week a duration stops being useful; show the date.
  const d = new Date(then)
  return `${d.getDate()}.${d.getMonth() + 1}`
}

/**
 * The same coarse buckets in the interface language. Hebrew is exactly
 * `relativeTimeHe` (byte-identical, including its process-timezone date). Other
 * languages word the bucket with `Intl.RelativeTimeFormat` — CLDR plurals, "yesterday"
 * for the 24–48 hour bucket — and write the date past a week in `BUSINESS_TZ`.
 *
 * The buckets are elapsed time, not calendar days ("yesterday" means 24–48 hours
 * ago in every language, as it always has in Hebrew), and the choice of bucket is
 * the same in every language. Like `relativeTimeHe`, call it with an injected
 * `nowMs`, never during a client render.
 */
export function relativeTime(iso: string | null | undefined, nowMs: number, locale: UiLocale = 'he'): string {
  if (locale === 'he') return relativeTimeHe(iso, nowMs)
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''

  const t = translatorFor(locale)
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' })
  const diffMs = nowMs - then
  if (diffMs < 0) return t('inbox.mobile.time.now')

  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return t('inbox.mobile.time.now')
  if (minutes < 60) return rtf.format(-minutes, 'minute')

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return rtf.format(-hours, 'hour')

  const days = Math.floor(hours / 24)
  if (days < 7) return rtf.format(-days, 'day')

  return new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'short', timeZone: BUSINESS_TZ }).format(then)
}
