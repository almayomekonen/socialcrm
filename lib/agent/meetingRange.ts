import { BUSINESS_TZ } from '@/lib/today/constants'
import { businessDateString, businessInstantMs, startOfBusinessDayMs } from '@/lib/today/time'

/**
 * The time window behind a meeting question ("היום", "מחר", "השבוע"), computed
 * on the server in the business timezone. Pure and DST-safe: every day step
 * goes +26h and re-snaps to the business day start (same rule as
 * `businessDayBounds`), so 23- and 25-hour days come out as one calendar day.
 *
 * The model chooses only the NAME of the period. It never supplies an instant.
 *
 * Weeks run Sunday to Saturday, the Israeli working week.
 */

export const MEETING_PERIODS = ['today', 'tomorrow', 'date', 'this_week', 'next_week', 'next_7_days', 'upcoming'] as const
export type MeetingPeriod = (typeof MEETING_PERIODS)[number]

export type MeetingRange = {
  period: MeetingPeriod
  /** Inclusive start, epoch ms. */
  fromMs: number
  /** Exclusive end, epoch ms; null = open-ended ("upcoming"). */
  toMs: number | null
  /** Business calendar dates for the window, for the answer and the evidence. */
  fromDate: string
  /** The last calendar day INSIDE the window; null when open-ended. */
  toDate: string | null
}

const DAY_STEP_MS = 26 * 3_600_000

function nextDayStart(dayStartMs: number, tz: string): number {
  return startOfBusinessDayMs(dayStartMs + DAY_STEP_MS, tz)
}

function addDays(dayStartMs: number, days: number, tz: string): number {
  let ms = dayStartMs
  for (let i = 0; i < days; i++) ms = nextDayStart(ms, tz)
  return ms
}

/** 0 = Sunday … 6 = Saturday, in the business timezone. */
function weekdayIndex(ms: number, tz: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date(ms))
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name)
}

function range(period: MeetingPeriod, fromMs: number, toMs: number | null, tz: string): MeetingRange {
  return {
    period,
    fromMs,
    toMs,
    fromDate: businessDateString(fromMs, tz),
    toDate: toMs === null ? null : businessDateString(toMs - 1, tz),
  }
}

/**
 * null when `period` is `date` and `date` is not a real YYYY-MM-DD.
 * "today" and the week periods include meetings earlier in that day or week,
 * so an answer can say a meeting already happened.
 */
export function meetingRange(period: MeetingPeriod, nowMs: number, date?: string, tz: string = BUSINESS_TZ): MeetingRange | null {
  const today = startOfBusinessDayMs(nowMs, tz)
  switch (period) {
    case 'today':
      return range(period, today, nextDayStart(today, tz), tz)
    case 'tomorrow': {
      const t = nextDayStart(today, tz)
      return range(period, t, nextDayStart(t, tz), tz)
    }
    case 'date': {
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
      const noon = businessInstantMs(date, '12:00', tz)
      if (Number.isNaN(noon) || businessDateString(noon, tz) !== date) return null
      const start = startOfBusinessDayMs(noon, tz)
      return range(period, start, nextDayStart(start, tz), tz)
    }
    case 'this_week': {
      const sunday = weekStart(today, tz)
      return range(period, sunday, addDays(sunday, 7, tz), tz)
    }
    case 'next_week': {
      const sunday = addDays(weekStart(today, tz), 7, tz)
      return range(period, sunday, addDays(sunday, 7, tz), tz)
    }
    case 'next_7_days':
      return range(period, nowMs, addDays(today, 7, tz), tz)
    case 'upcoming':
      return range(period, nowMs, null, tz)
  }
}

function weekStart(dayStartMs: number, tz: string): number {
  // Step back one calendar day at a time; at most six steps.
  let ms = dayStartMs
  for (let i = 0; i < 7 && weekdayIndex(ms, tz) !== 0; i++) ms = startOfBusinessDayMs(ms - 2 * 3_600_000, tz)
  return ms
}
