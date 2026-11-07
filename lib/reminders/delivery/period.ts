import { businessDateString, businessInstantMs } from '@/lib/today/time'

/**
 * Calendar periods for capacity accounting. Daily caps follow the BUSINESS day
 * (Asia/Jerusalem). The monthly budget follows the Meta billing month, in the
 * Meta account's own timezone (R6): never approximated with Asia/Jerusalem.
 */

/** "YYYY-MM-DD": the business day the instant falls on. */
export function businessDayKey(ms: number): string {
  return businessDateString(ms)
}

/** The billing month containing `ms`, in `tz` (IANA): its first day and its UTC bounds. */
export function billingMonth(ms: number, tz: string): { periodStart: string; startMs: number; endMs: number } {
  const [y, m] = businessDateString(ms, tz).split('-').map(Number)
  const first = `${y}-${String(m).padStart(2, '0')}-01`
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return { periodStart: first, startMs: businessInstantMs(first, '00:00', tz), endMs: businessInstantMs(next, '00:00', tz) }
}

/** True for a timezone name the runtime's Intl database knows. */
export function isValidTimezone(tz: string | null | undefined): tz is string {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
