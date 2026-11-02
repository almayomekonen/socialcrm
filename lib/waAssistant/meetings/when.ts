import { businessDateString, businessInstantMs, startOfBusinessDayMs } from '@/lib/today/time'

/**
 * WHEN, read deterministically from the owner's own Hebrew words, in the
 * business timezone. Pure.
 *
 * The Agent turns "תקבע לי עם איתמר מחר ב-10" into `date` + `startTime`, but a
 * meeting must never rest on the model's arithmetic alone. This reads the same
 * words with a small, fixed grammar; the WhatsApp layer creates a confirmation
 * only when both agree, and asks otherwise. Anything this cannot read with
 * certainty is reported as missing or ambiguous, never guessed:
 *
 *   dates  היום / מחר / מחרתיים (with ל/ב/ו/ש prefixes), "יום שלישי" (+ "הבא"),
 *          27.10 or 27/10/2026, and relative offsets: "בעוד 3 ימים",
 *          "בעוד שלושה ימים", "בעוד יומיים", "בעוד שבוע / שבועיים / 2 שבועות".
 *          A weekday equal to today needs "הבא"; a date already past is refused.
 *   times  10:30, "ב-10", "בשעה 10", with בבוקר / בערב / אחה"צ. A bare hour
 *          1-7 without one of those could be morning or evening: ambiguous.
 */

export type WhenProblem = 'ambiguous_date' | 'ambiguous_time' | 'past_date'
export type WhenParse = { date: string | null; time: string | null; problem: WhenProblem | null }

const HEB = '\\u05D0-\\u05EA'
const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'] as const

const word = (w: string) => new RegExp(`(?:^|[^${HEB}])[ולבש]?${w}(?![${HEB}])`, 'u')
const RE_TODAY = word('היום')
const RE_TOMORROW = word('מחר')
const RE_DAY_AFTER = word('מחרתיים')
const RE_WEEKDAY = new RegExp(`(?:^|[^${HEB}])[בל]?יום\\s+(${WEEKDAYS.join('|')})(?![${HEB}])(\\s+ה(?:בא|קרוב))?`, 'gu')
const RE_DMY = /(?<![\d:])(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?(?![\d:])/g
const RE_HHMM = /(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g
const RE_BARE_HOUR = new RegExp(`(?:^|[^${HEB}])(?:ב[-־–]?\\s?|בשעה\\s+)(\\d{1,2})(?![\\d:./])`, 'gu')
const NUMBER_WORDS: Record<string, number> = {
  אחד: 1, אחת: 1, שניים: 2, שתיים: 2, שני: 2, שתי: 2, שלושה: 3, שלוש: 3, ארבעה: 4, ארבע: 4, חמישה: 5, חמש: 5,
  שישה: 6, שש: 6, שבעה: 7, שבע: 7, שמונה: 8, תשעה: 9, תשע: 9, עשרה: 10, עשר: 10,
}
const RE_IN = new RegExp(
  `(?:^|[^${HEB}])[וש]?בעוד\\s+(?:(\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')})\\s+)?(ימים|יום|יומיים|שבועות|שבוע|שבועיים)(?![${HEB}])`,
  'gu',
)
const MAX_OFFSET_DAYS = 365

/** "בעוד שלושה ימים" → 3; null when the count cannot be read with certainty. */
function offsetDays(count: string | undefined, unit: string): number | null {
  if (unit === 'יומיים') return count ? null : 2
  if (unit === 'שבועיים') return count ? null : 14
  const n = count === undefined ? 1 : /^\d+$/.test(count) ? Number(count) : NUMBER_WORDS[count]
  if (!n || n < 1) return null
  const days = unit === 'שבוע' || unit === 'שבועות' ? n * 7 : n
  return days <= MAX_OFFSET_DAYS ? days : null
}

const RE_PM = /בערב|בלילה|אחה["״']?צ|אחר(?:י)? הצהריים/u
const RE_AM = /בבוקר/u

/** Calendar arithmetic on a YYYY-MM-DD in the business zone (DST-safe: +26h then re-snap). */
function addDays(dateStr: string, days: number): string {
  let ms = businessInstantMs(dateStr, '12:00')
  for (let i = 0; i < days; i++) ms = startOfBusinessDayMs(ms) + 26 * 3_600_000
  return businessDateString(ms)
}

function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

const pad = (n: number) => String(n).padStart(2, '0')

function readDates(text: string, today: string): { dates: string[]; problem: WhenProblem | null } {
  const dates: string[] = []
  let problem: WhenProblem | null = null
  if (RE_DAY_AFTER.test(text)) dates.push(addDays(today, 2))
  else if (RE_TOMORROW.test(text)) dates.push(addDays(today, 1))
  if (RE_TODAY.test(text)) dates.push(today)

  for (const m of text.matchAll(RE_WEEKDAY)) {
    const target = WEEKDAYS.indexOf(m[1] as (typeof WEEKDAYS)[number])
    let ahead = (target - weekdayOf(today) + 7) % 7
    if (ahead === 0) {
      if (!m[2]) problem = 'ambiguous_date'
      ahead = 7
    }
    dates.push(addDays(today, ahead))
  }

  for (const m of text.matchAll(RE_IN)) {
    const days = offsetDays(m[1], m[2])
    if (days === null) problem = problem ?? 'ambiguous_date'
    else dates.push(addDays(today, days))
  }

  for (const m of text.matchAll(RE_DMY)) {
    const day = Number(m[1])
    const month = Number(m[2])
    if (day < 1 || day > 31 || month < 1 || month > 12) continue
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(today.slice(0, 4))
    const iso = `${year}-${pad(month)}-${pad(day)}`
    // Round-trip through the calendar: 31.02 is not a date.
    if (businessDateString(businessInstantMs(iso, '12:00')) !== iso) continue
    if (iso < today) problem = problem ?? 'past_date'
    dates.push(iso)
  }
  return { dates: [...new Set(dates)], problem }
}

function readTimes(text: string): { times: string[]; problem: WhenProblem | null } {
  const pm = RE_PM.test(text)
  const am = RE_AM.test(text)
  const times: string[] = []
  let problem: WhenProblem | null = null
  const shift = (h: number) => (pm && h >= 1 && h <= 11 ? h + 12 : h)

  for (const m of text.matchAll(RE_HHMM)) times.push(`${pad(shift(Number(m[1])))}:${m[2]}`)
  const withoutHhmm = text.replace(RE_HHMM, ' ')
  for (const m of withoutHhmm.matchAll(RE_BARE_HOUR)) {
    const h = Number(m[1])
    if (h > 23) continue
    if (h === 0 || (h <= 7 && !pm && !am)) problem = 'ambiguous_time'
    times.push(`${pad(shift(h))}:00`)
  }
  return { times: [...new Set(times)], problem }
}

/** One message. */
export function parseHebrewWhen(text: string, nowMs: number): WhenParse {
  const today = businessDateString(nowMs)
  const d = readDates(text, today)
  const t = readTimes(text)
  const date = d.dates.length === 1 ? d.dates[0] : null
  const time = t.times.length === 1 ? t.times[0] : null
  const problem = d.dates.length > 1 ? 'ambiguous_date' : t.times.length > 1 ? 'ambiguous_time' : d.problem ?? t.problem
  return { date: problem === 'ambiguous_date' || problem === 'past_date' ? null : date, time: problem === 'ambiguous_time' ? null : time, problem }
}

/**
 * The current message first; a field it does not mention is taken from
 * `previous` (newest first), so "מחר" then "ב-10" is one request. The caller
 * passes only the message that our own clarification question answered, never
 * general history ("סכם לי את היום" must not become a meeting date).
 */
export function resolveWhen(current: string, previous: readonly string[], nowMs: number): WhenParse {
  const now = parseHebrewWhen(current, nowMs)
  if (now.problem) return now
  let { date, time } = now
  for (const text of previous) {
    if (date && time) break
    const p = parseHebrewWhen(text, nowMs)
    if (p.problem) continue
    date = date ?? p.date
    time = time ?? p.time
  }
  return { date, time, problem: null }
}

/** "יום שלישי, 20.10.2026" */
export function hebrewDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `יום ${WEEKDAYS[weekdayOf(dateStr)]}, ${d}.${m}.${y}`
}
