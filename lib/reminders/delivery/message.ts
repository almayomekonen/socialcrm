import { formatBusinessTime } from '@/lib/today/time'
import { REMINDER_LATE_NOTE_MS } from '@/lib/flags/personalReminderFlags'

/**
 * The reminder message the owner receives (product copy from the approved
 * journeys, architecture v1.0/v1.1; not consent wording):
 *   "תזכורת: הגיע הזמן להתקשר לאבי."   for an action said with "ל…"
 *   "תזכורת: {text}."                   otherwise
 * More than 5 minutes late (approved, B4) adds the time it was set for.
 * The text is the owner's own words, already single-line and ≤ 300 characters.
 */
export function reminderMessage(text: string, remindAtMs: number, nowMs: number): string {
  const t = text.trim().replace(/[.。]+$/u, '')
  const body = /^ל\p{L}/u.test(t) ? `תזכורת: הגיע הזמן ${t}.` : `תזכורת: ${t}.`
  return nowMs - remindAtMs > REMINDER_LATE_NOTE_MS ? `${body} (נקבעה ל-${formatBusinessTime(remindAtMs)})` : body
}
