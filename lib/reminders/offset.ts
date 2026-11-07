/**
 * Relative offsets after "בעוד", read deterministically from the owner's words.
 * Pure. Part of the personal-reminder time reader (./when.ts).
 *
 *   minutes  "בעוד דקה", "בעוד 5 דקות", "בעוד חמש דקות", "בעוד עשרים דקות"
 *   hours    "בעוד שעה", "בעוד שעתיים", "בעוד 3 שעות", "בעוד שלוש שעות",
 *            each optionally "וחצי" / "ורבע" / "ו-10 דקות"
 *   parts    "בעוד רבע שעה", "בעוד חצי שעה", "בעוד שלושת רבעי שעה"
 *
 * "בעוד N ימים / שבוע" is a DATE and is left to the shared date reader. Any other
 * "בעוד …" ("בעוד חמש עשרה דקות", "בעוד קצת") is reported as `ambiguous_offset`:
 * never guessed.
 */

const HEB = '\\u05D0-\\u05EA'

export const NUMBER_WORDS: Readonly<Record<string, number>> = {
  אחת: 1, אחד: 1, שתיים: 2, שתים: 2, שתי: 2, שניים: 2, שני: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4,
  חמש: 5, חמישה: 5, שש: 6, שישה: 6, שבע: 7, שבעה: 7, שמונה: 8, תשע: 9, תשעה: 9, עשר: 10, עשרה: 10,
  עשרים: 20, שלושים: 30, ארבעים: 40, חמישים: 50,
}

/** Longest first, so "שלושים" is not read as "שלוש". */
const WORDS = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|')
const NUM = `\\d{1,4}|${WORDS}`
const END = `(?![${HEB}])`

const RE_IN = new RegExp(`(?:^|[^${HEB}])[וש]?בעוד${END}`, 'gu')
const RE_PART = new RegExp(`^\\s+(רבע|חצי|שלושת רבעי|שלושה רבעי)\\s+שעה${END}`, 'u')
const RE_HOURS = new RegExp(
  `^\\s+(?:(${NUM})\\s+)?(שעה|שעות|שעתיים)${END}(?:\\s+(וחצי|ורבע)${END}|\\s+ו[-־]?\\s?(${NUM})\\s+(?:דקות|דקה)${END})?`,
  'u',
)
const RE_MINUTES = new RegExp(`^\\s+(?:(${NUM})\\s+)?(דקה|דקות)${END}`, 'u')
const RE_DAYS = new RegExp(`^\\s+(?:(${NUM})\\s+)?(ימים|יום|יומיים|שבועות|שבוע|שבועיים)${END}`, 'u')

const PARTS: Readonly<Record<string, number>> = { רבע: 15, חצי: 30, 'שלושת רבעי': 45, 'שלושה רבעי': 45 }

/** A count word or digits → a positive integer; null when it is not one. */
export function readCount(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw]
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function hoursToMinutes(m: RegExpMatchArray): number | null {
  const [, count, unit, half, extraMin] = m
  const n = readCount(count)
  let hours: number | null
  if (unit === 'שעתיים') hours = count === undefined ? 2 : null
  else if (unit === 'שעה') hours = count === undefined ? 1 : n === 1 ? 1 : null
  else hours = n !== null && n >= 2 ? n : null // "שעות" needs a count of two or more
  if (hours === null) return null
  let minutes = hours * 60
  if (half === 'וחצי') minutes += 30
  if (half === 'ורבע') minutes += 15
  if (extraMin !== undefined) {
    const extra = readCount(extraMin)
    if (extra === null || extra >= 60) return null
    minutes += extra
  }
  return minutes
}

export type OffsetRead = { minutes: number[]; problem: 'ambiguous_offset' | null }

/** Every "בעוד …" minute/hour offset in the text, in minutes. Day/week offsets are skipped (they are dates). */
export function readOffsets(text: string): OffsetRead {
  const minutes: number[] = []
  let problem: OffsetRead['problem'] = null
  for (const m of text.matchAll(RE_IN)) {
    const rest = text.slice((m.index ?? 0) + m[0].length)
    const part = RE_PART.exec(rest)
    if (part) {
      minutes.push(PARTS[part[1]])
      continue
    }
    const hours = RE_HOURS.exec(rest)
    if (hours) {
      const value = hoursToMinutes(hours)
      if (value === null) problem = 'ambiguous_offset'
      else minutes.push(value)
      continue
    }
    const mins = RE_MINUTES.exec(rest)
    if (mins) {
      const n = readCount(mins[1])
      const value = mins[2] === 'דקה' ? (mins[1] === undefined || n === 1 ? 1 : null) : n
      if (value === null) problem = 'ambiguous_offset'
      else minutes.push(value)
      continue
    }
    if (RE_DAYS.test(rest)) continue
    problem = 'ambiguous_offset'
  }
  return { minutes, problem }
}
