/**
 * WHEN for a personal owner reminder, read deterministically from the owner's
 * Hebrew words. Pure: no clock, no database, no model.
 *
 * Reminder Engine, Phase 2 (architecture v1.0–v1.6.1). Nothing calls it yet.
 * The Agent may propose a time, but a reminder is scheduled only at the instant
 * this reader derives from the owner's own message.
 *
 * THE ANCHOR is Meta's timestamp of the owner's inbound message, and only when
 * its provenance is verified (`source: 'meta'`). A server-time fallback or an
 * unknown source schedules nothing: `unverified_anchor`. Relative offsets
 * ("בעוד 5 דקות") are anchor + offset in absolute milliseconds, so a clock change
 * cannot shift them. "Today" and "tomorrow" are business days at the anchor.
 *
 * WALL-CLOCK TIMES ("מחר בתשע") go through `businessInstantMs`, so they follow
 * the Temporal-compatible clock-change rules (lib/today/time.ts).
 *
 * NEVER GUESSED. Anything unclear comes back as a reason the caller asks about.
 * That includes:
 *   - an hour 1–7 with no period;
 *   - two times, or two dates;
 *   - an offset together with a clock time or a date;
 *   - a time that has already passed. "היום בתשע" said at 14:30 is `past`;
 *     it is never read as 21:00.
 *
 * THE WINDOW, as approved:
 *   - effective now = max(now, anchor);
 *   - the time must be more than 60 s after it (otherwise `past` or `too_soon`);
 *   - and no more than 23 h after the anchor (otherwise `beyond_horizon`),
 *     because v1 delivers free-form text only, inside WhatsApp's 24 h window.
 */
import { businessDateString, businessInstantMs } from '@/lib/today/time'
import { BUSINESS_TZ } from '@/lib/today/constants'
import { readDates } from '@/lib/waAssistant/meetings/when'
import { readOffsets } from './offset'
import { readClock } from './clock'

export const REMINDER_HORIZON_MS = 23 * 60 * 60 * 1000
/** A reminder must be more than this far ahead of "now" when it is accepted. */
export const REMINDER_MIN_LEAD_MS = 60_000

/** Meta's message timestamp (seconds) and where it came from. Only 'meta' is trusted. */
export type ReminderAnchor = { messageTimestampSec: number | null; source: 'meta' | 'server' | null }

export type ReminderWhenAsk =
  | 'unverified_anchor'
  | 'ask_when'
  | 'ask_time'
  | 'ambiguous_time'
  | 'ambiguous_date'
  | 'ambiguous_offset'
  | 'conflicting'
  | 'past'
  | 'too_soon'
  | 'beyond_horizon'

export type ReminderWhen =
  | {
      ok: true
      remindAtMs: number
      basis: 'relative' | 'absolute'
      /** Minutes after the anchor, for a relative time. */
      offsetMinutes: number | null
      /** Business date and wall time of `remindAtMs`, for the confirmation card. */
      date: string
      time: string
    }
  | { ok: false; ask: ReminderWhenAsk; /** The hour as said, for "בבוקר או בערב?". */ hour?: number }

function wallTime(ms: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: BUSINESS_TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>
  return `${p.hour}:${p.minute}`
}

/** The approved window, for any candidate instant. */
export function checkReminderWindow(remindAtMs: number, anchorMs: number, nowMs: number): ReminderWhenAsk | null {
  const effectiveNow = Math.max(nowMs, anchorMs)
  const remaining = remindAtMs - effectiveNow
  if (remaining <= 0) return 'past'
  if (remaining <= REMINDER_MIN_LEAD_MS) return 'too_soon'
  if (remindAtMs - anchorMs > REMINDER_HORIZON_MS) return 'beyond_horizon'
  return null
}

export function readReminderWhen(text: string, anchor: ReminderAnchor, nowMs: number): ReminderWhen {
  const sec = anchor.messageTimestampSec
  if (anchor.source !== 'meta' || sec === null || !Number.isSafeInteger(sec) || sec <= 0) return { ok: false, ask: 'unverified_anchor' }
  const anchorMs = sec * 1000

  const offsets = readOffsets(text)
  const dates = readDates(text, businessDateString(anchorMs))
  const clock = readClock(text)
  const hasDateOrTime = dates.dates.length > 0 || clock.times.length > 0 || clock.problem !== null

  let remindAtMs: number
  let basis: 'relative' | 'absolute'
  let offsetMinutes: number | null = null

  if (offsets.problem || offsets.minutes.length > 1) return { ok: false, ask: 'ambiguous_offset' }
  if (offsets.minutes.length === 1) {
    if (hasDateOrTime) return { ok: false, ask: 'conflicting' }
    offsetMinutes = offsets.minutes[0]
    remindAtMs = anchorMs + offsetMinutes * 60_000
    basis = 'relative'
  } else {
    if (dates.dates.length > 1 || dates.problem === 'ambiguous_date') return { ok: false, ask: 'ambiguous_date' }
    if (dates.problem === 'past_date') return { ok: false, ask: 'past' }
    if (clock.problem) return clock.hour === null ? { ok: false, ask: 'ambiguous_time' } : { ok: false, ask: 'ambiguous_time', hour: clock.hour }
    if (clock.times.length === 0) return { ok: false, ask: dates.dates.length ? 'ask_time' : 'ask_when' }
    const date = dates.dates[0] ?? businessDateString(anchorMs)
    remindAtMs = businessInstantMs(date, clock.times[0])
    if (Number.isNaN(remindAtMs)) return { ok: false, ask: 'ambiguous_time' }
    basis = 'absolute'
  }

  const outside = checkReminderWindow(remindAtMs, anchorMs, nowMs)
  if (outside) return { ok: false, ask: outside }
  return { ok: true, remindAtMs, basis, offsetMinutes, date: businessDateString(remindAtMs), time: wallTime(remindAtMs) }
}
