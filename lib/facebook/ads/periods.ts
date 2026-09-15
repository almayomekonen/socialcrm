/**
 * The comparison period: the same number of days immediately before the one
 * shown. Built from Meta's own `date_start` / `date_stop` of the current report
 * (already in the AD ACCOUNT's timezone — a preset like "this_month" is resolved
 * by Meta), so both periods are the same kind of calendar days. Pure.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function toUtcMs(day: string): number | null {
  if (!ISO_DAY.test(day)) return null
  const ms = Date.parse(`${day}T00:00:00Z`)
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== day ? null : ms
}

const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export type DayRange = { since: string; until: string }

/** Inclusive day count, or null for a malformed/reversed range. */
export function dayCount(range: DayRange): number | null {
  const start = toUtcMs(range.since)
  const stop = toUtcMs(range.until)
  if (start === null || stop === null || stop < start) return null
  return Math.round((stop - start) / DAY_MS) + 1
}

/** The equally long range ending the day before `range.since`; null if `range` is not a real range. */
export function previousEquivalentRange(range: DayRange): DayRange | null {
  const days = dayCount(range)
  const start = toUtcMs(range.since)
  if (days === null || start === null) return null
  const until = start - DAY_MS
  return { since: toDay(until - (days - 1) * DAY_MS), until: toDay(until) }
}

/**
 * Relative change for display. Null — rendered as no comparison — when either
 * side is unknown, or the previous value is 0 (a percentage of nothing is not a
 * number a business owner can use).
 */
export function relativeChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null
  return (current - previous) / Math.abs(previous)
}
