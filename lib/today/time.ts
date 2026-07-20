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
 * Business-day bounds for `nowMs`. `dayEnd` is the start of the NEXT business day
 * (advancing +26h before re-snapping absorbs 23h/25h DST-transition days), so
 * `[dayStart, dayEnd)` is always exactly one wall-clock day.
 */
export function businessDayBounds(nowMs: number, tz: string = BUSINESS_TZ): NowCtx {
  const dayStart = startOfBusinessDayMs(nowMs, tz)
  const dayEnd = startOfBusinessDayMs(dayStart + 26 * 3_600_000, tz)
  return { nowMs, dayStart, dayEnd }
}
