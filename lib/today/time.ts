// Today brief — the ONLY authority for the "today" boundary (INV-8). Pure and
// DST-aware: the timezone offset is derived from the actual instant, never
// hardcoded. Server-only in practice; no client ever calls this.

import { BUSINESS_TZ } from './constants'
import type { UiLocale } from '@/lib/i18n/config'
import { intlLocale } from '@/lib/i18n/translate'
import type { NowCtx } from './types'

/**
 * Start-of-day in `tz` for the instant `ms`, returned as a UTC epoch ms.
 *
 * The offset is the one in force AT THAT MIDNIGHT, not at `ms`. Applying the
 * offset at `ms` was off by an hour on the two DST-change days a year for any
 * instant after the change: on 2026-03-27 it returned 23:00 of the 26th, on
 * 2026-10-25 01:00 of the 25th (a meeting at 00:30 fell out of "today").
 * `businessInstantMs` converges on the real instant of the 00:00 wall clock.
 * Israel changes clocks at 02:00, so local midnight always exists.
 */
export function startOfBusinessDayMs(ms: number, tz: string = BUSINESS_TZ): number {
  return businessInstantMs(businessDateString(ms, tz), '00:00', tz)
}

/**
 * The business calendar date for the instant `ms`, as `YYYY-MM-DD`.
 *
 * Extends this module rather than deriving a second day boundary elsewhere
 * (architecture-rules §11): a `date` column such as `sales_quotes."expiresAt"`
 * is answered by comparing calendar dates, and ISO dates compare correctly as
 * strings. `en-CA` is the locale whose short date format IS `YYYY-MM-DD`.
 *
 * DST-safe by construction — the calendar date in a timezone never depends on
 * an offset arithmetic step.
 */
export function businessDateString(ms: number, tz: string = BUSINESS_TZ): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms))
}

/**
 * Business-day bounds for `nowMs`. `dayEnd` is the start of the NEXT business day
 * (advancing +26h before re-snapping absorbs 23h/25h DST-transition days), so
 * `[dayStart, dayEnd)` is always exactly one wall-clock day.
 */
export function businessDayBounds(nowMs: number, tz: string = BUSINESS_TZ): NowCtx {
  const dayStart = startOfBusinessDayMs(nowMs, tz)
  const dayEnd = startOfBusinessDayMs(dayStart + 26 * 3_600_000, tz)
  return { nowMs, dayStart, dayEnd }
}

/**
 * Display formatting in the business timezone. Server Components run in UTC on
 * Vercel, so `lib/dates` formatters would show a 13:00 Israel message as 10:00
 * and split day separators at UTC midnight. Same output shape as lib/dates
 * (`dd/mm/yyyy`, `HH:MM`), explicit timezone.
 */
export function formatBusinessDate(value: Date | string | number, tz: string = BUSINESS_TZ): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('he-IL', { timeZone: tz }).format(d).replaceAll('.', '/')
}

/**
 * Hebrew keeps the exact `he-IL` output every existing caller relies on. Other
 * interface locales use their own conventions but a 24-hour clock, so the
 * fixed-width time chips (Today meetings) never wrap to "02:00 PM".
 */
function businessIntlTag(locale: UiLocale): string {
  return locale === 'he' ? 'he-IL' : intlLocale(locale)
}

export function formatBusinessTime(value: Date | string | number, tz: string = BUSINESS_TZ, locale: UiLocale = 'he'): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const hourCycle = locale === 'he' ? {} : { hourCycle: 'h23' as const }
  return new Intl.DateTimeFormat(businessIntlTag(locale), { timeZone: tz, hour: '2-digit', minute: '2-digit', ...hourCycle }).format(d)
}

/** e.g. "יום חמישי, 22 באוקטובר" — the Today header date, in the business timezone. */
export function formatBusinessLongDate(value: Date | string | number, tz: string = BUSINESS_TZ, locale: UiLocale = 'he'): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(businessIntlTag(locale), { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(d)
}

export function formatBusinessDateTime(value: Date | string | number, tz: string = BUSINESS_TZ): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('he-IL', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(d).replaceAll('.', '/')
}

/**
 * The wall-clock time in `tz` for an instant, expressed as the epoch ms you would
 * get by reading those same digits as UTC. Only useful as the inverse below.
 */
function wallClockMs(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms))
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value])) as Record<string, string>
  // Some engines render midnight as hour 24 under hour12:false.
  const hour = p.hour === '24' ? '00' : p.hour
  return Date.parse(`${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}Z`)
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * `2026-09-07` + `10:00` in the business timezone → the real UTC instant.
 *
 * THE INVERSE OF EVERY OTHER HELPER HERE, and the one a meeting needs: a rep who
 * says "מחר ב-10" means ten in the morning where they are, and the row has to
 * hold the instant that corresponds to. `new Date('2026-09-07T10:00')` on a
 * Vercel server is 10:00 UTC — 13:00 in Jerusalem — so the meeting would be
 * three hours late, every time, invisibly.
 *
 * NO OFFSET TABLE. The offset is whatever the `Intl` database says at the
 * instant in question. A wall-clock time can sit next to at most one DST
 * transition, so the offsets in force a day before and a day after are the only
 * candidates. Each candidate instant is kept only if it really shows this wall
 * time in the zone.
 *
 * CLOCK-CHANGE DAYS follow JavaScript Temporal's "compatible" rule:
 *   - a time that occurs twice (Israel fall-back, 01:00-01:59) is the FIRST
 *     occurrence, the earlier instant;
 *   - a time that does not exist (Israel spring-forward, 02:00-02:59) moves
 *     FORWARD by the gap: 02:30 is 03:30. The old convergence loop returned
 *     01:30 there, an hour early.
 * Every other time is unchanged: exactly one candidate matches.
 *
 * Returns NaN for input it cannot parse, so a caller must check rather than
 * silently persisting an Invalid Date.
 */
export function businessInstantMs(dateStr: string, timeStr: string, tz: string = BUSINESS_TZ): number {
  const target = Date.parse(`${dateStr}T${timeStr}:00Z`)
  if (Number.isNaN(target)) return Number.NaN
  const offsetAt = (ms: number) => wallClockMs(ms, tz) - ms
  const before = offsetAt(target - DAY_MS)
  const after = offsetAt(target + DAY_MS)
  const matching = [...new Set([before, after])].map((offset) => target - offset).filter((ms) => wallClockMs(ms, tz) === target)
  // Twice (overlap): the earlier instant. Once: that instant.
  if (matching.length > 0) return Math.min(...matching)
  // Never (gap): read with the offset from before the change, so the wall time
  // lands forward by the size of the gap.
  return target - before
}
