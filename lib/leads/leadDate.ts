import type { UiLocale } from '@/lib/i18n/config'
import { formatDate as formatLocaleDate, formatDateTime as formatLocaleDateTime } from '@/lib/i18n/format'
import { BUSINESS_TZ } from '@/lib/today/constants'
import { formatDate, formatDateTime } from '@/lib/dates'

/**
 * A lead date (follow-up, last activity, task due date) for the lead screens.
 * Hebrew keeps its exact legacy output (`formatDate`, unchanged for every
 * existing customer); other interface languages format in the business
 * timezone (`BUSINESS_TZ`), never the server's.
 */
export function formatLeadDate(locale: UiLocale, at: string | Date): string {
  if (locale === 'he') return formatDate(at)
  // Same fallback as `formatDate`: a value that is not a date is shown as stored.
  if (Number.isNaN(new Date(at).getTime())) return String(at)
  return formatLocaleDate(locale, at, BUSINESS_TZ, 'short')
}

/** A lead date WITH its time (task notes). Same rule: Hebrew keeps legacy `formatDateTime`. */
export function formatLeadDateTime(locale: UiLocale, at: string | Date): string {
  if (locale === 'he') return formatDateTime(at)
  if (Number.isNaN(new Date(at).getTime())) return String(at)
  return formatLocaleDateTime(locale, at, BUSINESS_TZ, 'short')
}
