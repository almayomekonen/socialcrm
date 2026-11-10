/**
 * Relative offsets ("in 10 minutes"), read deterministically from the owner's
 * words. Pure. Part of the personal-reminder time reader (./when.ts).
 *
 * TRIGGER  "בעוד", and the spoken "עוד" / "לעוד" (optionally ו/ש before it).
 *          "בעוד" always announces a duration: anything we cannot read after it
 *          is `ambiguous_offset`. A bare "עוד" is an ordinary word too ("עוד
 *          חלב"), so it counts ONLY when a minute/hour duration follows.
 *
 *   minutes  "בעוד דקה", "בעוד 5 דקות", "עוד חמש דקות", "בעוד חמש עשרה דקות",
 *            "בעוד עשרים וחמש דקות", "בעוד דקותיים", "בעוד 10 דק׳"
 *   hours    "בעוד שעה", "בעוד שעתיים", "בעוד 3 שעות", "בעוד 1.5 שעות",
 *            "בעוד שלוש וחצי שעות", each optionally "וחצי" / "ורבע" / "ו-10 דקות"
 *   parts    "בעוד רבע שעה", "בעוד חצי שעה", "בעוד שלושת רבעי שעה"
 *   approx   "בעוד כ-10 דקות", "בעוד בערך שעה", "בעוד שעה בערך": the stated
 *            amount. The confirmation card shows the exact time before anything
 *            is scheduled.
 *
 * "בעוד N ימים / שבוע" is a DATE and is left to the shared date reader. Anything
 * else after "בעוד" ("בעוד קצת", "בעוד כמה דקות") is `ambiguous_offset`: never guessed.
 *
 * `stripOffsets` cuts exactly the characters each offset occupies, so the
 * reminder TEXT is cut with the same reading that produced the TIME (./request.ts).
 */

const HEB = '\\u05D0-\\u05EA'
const END = `(?![${HEB}])`

/** 1–10, both genders, as said before a noun. */
const UNITS: Readonly<Record<string, number>> = {
  אחת: 1, אחד: 1, שתיים: 2, שתים: 2, שתי: 2, שניים: 2, שני: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4,
  חמש: 5, חמישה: 5, שש: 6, שישה: 6, שבע: 7, שבעה: 7, שמונה: 8, תשע: 9, תשעה: 9, עשר: 10, עשרה: 10,
}
const TENS: Readonly<Record<string, number>> = { עשרים: 20, שלושים: 30, ארבעים: 40, חמישים: 50, שישים: 60, שבעים: 70, שמונים: 80, תשעים: 90 }
/** The first word of 11–19 ("חמש עשרה", "שנים עשר"). */
const TEEN_HEADS: Readonly<Record<string, number>> = {
  אחת: 1, אחד: 1, שתים: 2, שתיים: 2, שנים: 2, שתי: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5,
  שש: 6, שישה: 6, שבע: 7, שבעה: 7, שמונה: 8, תשע: 9, תשעה: 9,
}

/** Every number word we read, 1–99, mapped to its value. */
export const NUMBER_WORDS: Readonly<Record<string, number>> = (() => {
  const out: Record<string, number> = { ...UNITS, ...TENS }
  for (const [w, n] of Object.entries(TEEN_HEADS)) {
    out[`${w} עשרה`] = 10 + n
    out[`${w} עשר`] = 10 + n
  }
  for (const [t, tn] of Object.entries(TENS)) for (const [u, un] of Object.entries(UNITS)) if (un < 10) out[`${t} ו${u}`] = tn + un
  return out
})()

/** Longest first, so "שלושים" is not read as "שלוש" and "חמש עשרה" not as "חמש". */
const WORDS = Object.keys(NUMBER_WORDS)
  .sort((a, b) => b.length - a.length)
  .map((w) => w.replace(/ /g, '\\s+'))
  .join('|')
const NUM = `\\d{1,4}(?:[.,]\\d{1,2})?|(?:${WORDS})${END}`
/** "כ-10", "כ10", "בערך", "בסביבות": the stated amount is used. */
const APPROX = `(?:כ[-־]?\\s?(?=\\d)|כ[-־]\\s?|בערך\\s+|בסביבות\\s+)?`
/** Words after the duration that belong to it: "בערך", "מעכשיו". */
const TAIL = `(?:\\s+(?:בערך|מעכשיו|מעכשו|מהרגע)${END})*`

const RE_IN = new RegExp(`(?:^|[^${HEB}])((?:[וש]?ב|[וש]?ל|[וש])?עוד)${END}`, 'gu')
const RE_PART = new RegExp(`^\\s+${APPROX}(רבע|חצי|שלושת\\s+רבעי|שלושה\\s+רבעי)\\s+שעה${END}${TAIL}`, 'u')
const RE_HOURS = new RegExp(
  `^\\s+${APPROX}(?:(${NUM})\\s+(?:(וחצי|ורבע)${END}\\s+)?)?(שעה|שעות|שעתיים)${END}(?:\\s+(וחצי|ורבע)${END}|\\s+ו[-־]?\\s?(${NUM})\\s+(?:דקות|דקה)${END})?${TAIL}`,
  'u',
)
const RE_MINUTES = new RegExp(`^\\s+${APPROX}(?:(${NUM})\\s+)?(דקותיים|דקות|דקה|דק['׳]?)${END}${TAIL}`, 'u')
const RE_DAYS = new RegExp(`^\\s+(?:(${NUM})\\s+)?(ימים|יום|יומיים|שבועות|שבוע|שבועיים)${END}`, 'u')

const PARTS: Readonly<Record<string, number>> = { רבע: 15, חצי: 30, 'שלושת רבעי': 45, 'שלושה רבעי': 45 }

/** A count word or digits → a positive number (decimals allowed); null when it is not one. */
export function readAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const t = raw.replace(/\s+/g, ' ').trim()
  const n = /^\d+(?:[.,]\d+)?$/.test(t) ? Number(t.replace(',', '.')) : NUMBER_WORDS[t]
  return Number.isFinite(n) && n > 0 ? n : null
}

/** A count word or digits → a positive INTEGER; null when it is not one. */
export function readCount(raw: string | undefined): number | null {
  const n = readAmount(raw)
  return n !== null && Number.isSafeInteger(n) ? n : null
}

/** Whole minutes, or null when the amount does not land on a whole minute ("בעוד 2.3 דקות"). */
const whole = (minutes: number): number | null => {
  const r = Math.round(minutes)
  return Math.abs(minutes - r) < 1e-9 && r > 0 ? r : null
}

function hoursToMinutes(m: RegExpMatchArray): number | null {
  const [, count, preHalf, unit, half, extraMin] = m
  const n = readAmount(count)
  let hours: number | null
  if (unit === 'שעתיים') hours = count === undefined ? 2 : null
  else if (unit === 'שעה') hours = count === undefined ? 1 : n !== null && n <= 1 ? n : null // "שעה", "0.5 שעה"
  // "שעות" needs a count: 2 or more, a fraction ("1.5 שעות") or "X וחצי שעות".
  else hours = n !== null && (n >= 2 || !Number.isInteger(n) || preHalf !== undefined) ? n : null
  if (hours === null) return null
  // "שלוש וחצי שעות" already carries its half; a second one, or a fraction plus a half, is unclear.
  if (preHalf !== undefined && (!Number.isInteger(hours) || half !== undefined || extraMin !== undefined)) return null
  let minutes = hours * 60
  const extraHalf = preHalf ?? half
  if (extraHalf === 'וחצי') minutes += 30
  if (extraHalf === 'ורבע') minutes += 15
  if (extraMin !== undefined) {
    const extra = readCount(extraMin)
    if (extra === null || extra >= 60 || !Number.isInteger(hours)) return null
    minutes += extra
  }
  return whole(minutes)
}

function minutesOf(m: RegExpMatchArray): number | null {
  const [, count, unit] = m
  if (unit === 'דקותיים') return count === undefined ? 2 : null
  if (unit === 'דקה') return count === undefined || readCount(count) === 1 ? 1 : null
  if (count === undefined) return null // "בעוד דקות"
  const n = readAmount(count)
  return n === null ? null : whole(n)
}

export type OffsetRead = { minutes: number[]; problem: 'ambiguous_offset' | null }
type Span = { from: number; to: number; days: boolean }
type Scan = OffsetRead & { spans: Span[] }

function scan(text: string): Scan {
  const minutes: number[] = []
  const spans: Span[] = []
  let problem: OffsetRead['problem'] = null
  for (const m of text.matchAll(RE_IN)) {
    const strict = m[1].includes('בעוד')
    const restAt = (m.index ?? 0) + m[0].length
    const start = restAt - m[1].length
    const rest = text.slice(restAt)
    const take = (hit: RegExpExecArray, value: number | null) => {
      if (value === null) {
        if (strict) problem = 'ambiguous_offset'
        return
      }
      minutes.push(value)
      spans.push({ from: start, to: restAt + hit[0].length, days: false })
    }
    const part = RE_PART.exec(rest)
    if (part) {
      take(part, PARTS[part[1].replace(/\s+/g, ' ')])
      continue
    }
    const hours = RE_HOURS.exec(rest)
    if (hours) {
      take(hours, hoursToMinutes(hours))
      continue
    }
    const mins = RE_MINUTES.exec(rest)
    if (mins) {
      take(mins, minutesOf(mins))
      continue
    }
    const days = RE_DAYS.exec(rest)
    if (days) {
      // A date, read by the shared date reader. Only "בעוד" is one: "עוד יום" is just words.
      if (strict) spans.push({ from: start, to: restAt + days[0].length, days: true })
      continue
    }
    if (strict) problem = 'ambiguous_offset'
  }
  return { minutes, problem, spans }
}

/** Every minute/hour offset in the text, in minutes. Day/week offsets are skipped (they are dates). */
export function readOffsets(text: string): OffsetRead {
  const { minutes, problem } = scan(text)
  return { minutes, problem }
}

/**
 * The text with every offset this reader recognised replaced by a space.
 * `keepDays` leaves "בעוד N ימים" in place, for the date reader to read.
 */
export function stripOffsets(text: string, opts: { keepDays?: boolean } = {}): string {
  let out = text
  const spans = scan(text).spans.filter((s) => !(opts.keepDays && s.days))
  for (const s of spans.sort((x, y) => y.from - x.from)) out = `${out.slice(0, s.from)} ${out.slice(s.to)}`
  return out
}
