/**
 * Date presentation for the billing centre. Pure, deterministic, server-only
 * by convention — every value these produce is computed once during the RSC
 * render and passed down as text, never recomputed in a Client Component.
 *
 * Both helpers are pinned to BUSINESS_TZ rather than the process timezone.
 * Vercel runs in UTC while the נציג reads the page in Israel, so an unpinned
 * "next renewal" would name the wrong day for any timestamp in the evening
 * hours, and an unpinned day count would be off by one for part of every day.
 * The boundary is derived through Intl, so DST transitions are handled by the
 * timezone database instead of a hardcoded +2/+3 offset.
 */

const BUSINESS_TZ = 'Asia/Jerusalem'
const MS_PER_DAY = 86_400_000

/** "4 בספטמבר" — or "4 בספטמבר 2026" with the year. */
export function formatRenewalDate(date: Date, opts: { withYear?: boolean } = {}): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: BUSINESS_TZ,
    day: 'numeric',
    month: 'long',
    ...(opts.withYear ? { year: 'numeric' } : {}),
  }).format(date)
}

/** Calendar day this instant falls on in BUSINESS_TZ, as a day number. */
function businessDayIndex(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day')) / MS_PER_DAY
}

/** Whole calendar days from `now` until `date`. Never negative. */
export function daysUntil(date: Date, now: Date = new Date()): number {
  return Math.max(0, businessDayIndex(date) - businessDayIndex(now))
}

/** "היום" / "בעוד יום" / "בעוד 27 ימים". */
export function relativeDaysLabel(days: number): string {
  if (days === 0) return 'היום'
  if (days === 1) return 'בעוד יום'
  return `בעוד ${days} ימים`
}
