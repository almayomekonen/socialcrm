/**
 * Date presentation for the billing centre. Pure, deterministic, server-only
 * by convention — every value these produce is computed once during the RSC
 * render and passed down as text, never recomputed in a Client Component.
 *
 * Both helpers are pinned to BUSINESS_TZ rather than the process timezone.
 * Vercel runs in UTC while the נציג reads the page in Israel, so an unpinned
 * "next renewal" would name the wrong day for any timestamp in the evening
 * hours, and an unpinned day count would be off by one for part of every day.
 * The boundary is derived through Intl, so DST transitions are handled by the
 * timezone database instead of a hardcoded +2/+3 offset.
 */

import type { UiLocale } from '@/lib/i18n/config'
import { intlLocale } from '@/lib/i18n/translate'
import { translatorFor } from '@/lib/i18n/translators'

const BUSINESS_TZ = 'Asia/Jerusalem'
const MS_PER_DAY = 86_400_000

/** "4 בספטמבר" — or "4 בספטמבר 2026" with the year. `locale` (default Hebrew, unchanged) names the month in the interface language. */
export function formatRenewalDate(date: Date, opts: { withYear?: boolean } = {}, locale: UiLocale = 'he'): string {
  return new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : intlLocale(locale), {
    timeZone: BUSINESS_TZ,
    day: 'numeric',
    month: 'long',
    ...(opts.withYear ? { year: 'numeric' } : {}),
  }).format(date)
}

/** Calendar day this instant falls on in BUSINESS_TZ, as a day number. */
function businessDayIndex(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day')) / MS_PER_DAY
}

/**
 * Whole calendar days from `now` until `date`. SIGNED: negative for a date that
 * has passed.
 *
 * It used to clamp at zero, which turned every past date into "0 days away" and
 * therefore into "היום". On 26 September the billing centre rendered a period
 * that ended on the 22nd as "22 בספטמבר · היום" — a date and a relative label
 * contradicting each other on the same line. Clamping hid the past instead of
 * describing it.
 */
export function daysUntil(date: Date, now: Date = new Date()): number {
  return businessDayIndex(date) - businessDayIndex(now)
}

/**
 * `relativeDaysLabel` in the interface language (`settings.payment.days`);
 * Hebrew is `relativeDaysLabel` itself. A separate function so the Hebrew one
 * keeps its exact one-argument shape.
 */
export function relativeDaysLabelFor(days: number, locale: UiLocale): string {
  if (locale === 'he') return relativeDaysLabel(days)
  const t = translatorFor(locale)
  if (days === 0) return t('settings.payment.days.today')
  if (days === 1) return t('settings.payment.days.tomorrow')
  if (days === -1) return t('settings.payment.days.yesterday')
  return days < -1 ? t('settings.payment.days.ago', { count: Math.abs(days) }) : t('settings.payment.days.in', { count: days })
}

/** "לפני 4 ימים" / "אתמול" / "היום" / "בעוד יום" / "בעוד 27 ימים". */
export function relativeDaysLabel(days: number): string {
  if (days === 0) return 'היום'
  if (days === 1) return 'בעוד יום'
  if (days === -1) return 'אתמול'
  if (days < -1) return `לפני ${Math.abs(days)} ימים`
  return `בעוד ${days} ימים`
}
