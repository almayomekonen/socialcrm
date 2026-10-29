import heLocale from '@fullcalendar/core/locales/he'
import arLocale from '@fullcalendar/core/locales/ar'
import type { LocaleInput } from '@fullcalendar/core'
import type { UiLocale } from '@/lib/i18n/config'

/**
 * FullCalendar's own locale pack for the grid text it renders itself (title,
 * weekday / month names, "+N more", the prev/next names). Hebrew is the pack
 * the grid always used. English is FullCalendar's built-in default. Arabic is
 * its `ar` pack with Latin digits (`nu-latn`, the product rule for Arabic),
 * since FullCalendar hands the code straight to `Intl.DateTimeFormat`.
 *
 * Week start, clock and time zone are NOT taken from the pack: the view passes
 * `firstDay={0}` and 24-hour formats explicitly in every language, and the grid
 * keeps FullCalendar's browser-local time zone (unchanged).
 */
export function fullCalendarLocale(locale: UiLocale): LocaleInput | string {
  if (locale === 'he') return heLocale
  if (locale === 'ar') return { ...arLocale, code: 'ar-u-nu-latn' }
  return 'en'
}
