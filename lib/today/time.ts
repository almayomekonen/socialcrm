// Today brief — the ONLY authority for the "today" boundary (INV-8). Pure and
// DST-aware: the timezone offset is derived from the actual instant, never
// hardcoded. Server-only in practice; no client ever calls this.

import { BUSINESS_TZ } from './constants'
import type { NowCtx } from './types'

/** Start-of-day in `tz` for the instant `ms`, returned as a UTC epoch ms. */
export function startOfBusinessDayMs(ms: number, tz: string = BUSINESS_TZ): number {
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
  const hour = p.hour === '24' ? 0 : Number(p.hour) // some engines emit '24' at midnight
  const wallAsUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second))
  const offset = wallAsUtc - ms
  const startWall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), 0, 0, 0)
  return startWall - offset
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

export function formatBusinessTime(value: Date | string | number, tz: string = BUSINESS_TZ): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('he-IL', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(d)
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

/**
 * `2026-09-07` + `10:00` in the business timezone → the real UTC instant.
 *
 * THE INVERSE OF EVERY OTHER HELPER HERE, and the one a meeting needs: a rep who
 * says "מחר ב-10" means ten in the morning where they are, and the row has to
 * hold the instant that corresponds to. `new Date('2026-09-07T10:00')` on a
 * Vercel server is 10:00 UTC — 13:00 in Jerusalem — so the meeting would be
 * three hours late, every time, invisibly.
 *
 * SOLVED BY CONVERGENCE, not by an offset table. The offset is whatever the
 * `Intl` database says it is at the instant in question, which is the only
 * DST-correct answer; guessing, correcting by the error, and repeating settles
 * in one step for ordinary times and two across a transition. Three passes is
 * one more than any real case needs.
 *
 * Returns NaN for input it cannot parse, so a caller must check rather than
 * silently persisting an Invalid Date.
 */
export function businessInstantMs(dateStr: string, timeStr: string, tz: string = BUSINESS_TZ): number {
  const target = Date.parse(`${dateStr}T${timeStr}:00Z`)
  if (Number.isNaN(target)) return Number.NaN
  let guess = target
  for (let i = 0; i < 3; i++) guess += target - wallClockMs(guess, tz)
  return guess
}
