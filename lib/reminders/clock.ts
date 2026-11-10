/**
 * Clock times for a personal reminder, read deterministically from the owner's
 * words. Pure. Part of the personal-reminder time reader (./when.ts).
 *
 *   digits  "10:30", "ב-9", "בשעה 16", "ב-9 וחצי", "ב-8 ורבע"
 *   words   "בתשע", "בשמונה וחצי", "בשעה עשר", "באחת עשרה", "בשתים עשרה"
 *   period  בבוקר / בצהריים, אחה"צ, אחר הצהריים / בערב, הערב / בלילה, הלילה
 *
 * Never guessed. Each of these is `ambiguous_time`:
 *   - a bare hour 1–7, or 0, with no period ("מחר בשלוש");
 *   - an hour that does not fit its period ("בשמונה בצהריים");
 *   - "פחות" after an hour ("בתשע פחות רבע");
 *   - two different times, or two different periods.
 * "HH:MM" is taken as written. A period word shifts it only when it is 1–11.
 */
const HEB = '\\u05D0-\\u05EA'
const END = `(?![${HEB}])`

/**
 * Hours as they are said: the feminine forms only. "שני" or "שתי" is not an hour
 * ("בשני" is Monday), so it never becomes one.
 */
const HOUR_WORDS: Readonly<Record<string, number>> = {
  אחת: 1, שתיים: 2, שתים: 2, שלוש: 3, ארבע: 4, חמש: 5, שש: 6, שבע: 7, שמונה: 8, תשע: 9, עשר: 10,
  'אחת עשרה': 11, 'שתים עשרה': 12, 'שתיים עשרה': 12,
}
const HOUR_WORD_ALT = Object.keys(HOUR_WORDS).sort((a, b) => b.length - a.length).join('|')

const RE_HHMM = /(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/g
const RE_DIGIT_HOUR = new RegExp(`(?:^|[^${HEB}])(?:ב[-־–]?\\s?|בשעה\\s+)(\\d{1,2})(?![\\d:./])`, 'gu')
const RE_WORD_HOUR = new RegExp(`(?:^|[^${HEB}])(?:ב|בשעה\\s+)(${HOUR_WORD_ALT})${END}`, 'gu')
const RE_SUFFIX = new RegExp(`^\\s+(וחצי|ורבע|פחות)${END}`, 'u')

type Period = 'morning' | 'noon' | 'evening' | 'night'
const PERIODS: ReadonlyArray<[Period, RegExp]> = [
  ['morning', /בבוקר/u],
  ['noon', /בצהריים|אחה["״']?צ|אחר(?:י)? הצהריים/u],
  ['evening', /בערב|(?<![\p{L}])הערב(?![\p{L}])/u],
  ['night', /בלילה|(?<![\p{L}])הלילה(?![\p{L}])/u],
]

/**
 * A part of the day said WITHOUT an hour ("מחר בבוקר", "היום בערב"): the time
 * the reminder is proposed for. Never scheduled as is: the confirmation card
 * shows this exact time, and the owner approves it or rejects it.
 * Null when no part of the day was said, or two different ones.
 */
export const PERIOD_DEFAULT_TIME: Readonly<Record<Period | 'afternoon', string>> = {
  morning: '09:00',
  noon: '12:00',
  afternoon: '16:00',
  evening: '19:00',
  night: '21:00',
}
const AFTERNOON = /אחה["״']?צ|אחר(?:י)? הצהריים/u

export function periodDefaultTime(text: string): string | null {
  const found = PERIODS.filter(([, re]) => re.test(text)).map(([p]) => p)
  if (found.length !== 1) return null
  return found[0] === 'noon' && AFTERNOON.test(text) && !/בצהריים/u.test(text) ? PERIOD_DEFAULT_TIME.afternoon : PERIOD_DEFAULT_TIME[found[0]]
}

/** The hour 0–23 for an hour as said plus its period, or null when it does not fit. */
export function hourFor(h: number, period: Period | null): number | null {
  if (h < 0 || h > 23) return null
  switch (period) {
    case null:
      return h >= 8 ? h : null // 0–7 alone could be morning or evening
    case 'morning':
      return h >= 1 && h <= 11 ? h : null
    case 'noon':
      if (h === 12) return 12
      if (h >= 1 && h <= 7) return h + 12
      return h >= 13 && h <= 19 ? h : null
    case 'evening':
      if (h >= 5 && h <= 11) return h + 12
      return h >= 17 && h <= 23 ? h : null
    case 'night':
      if (h >= 9 && h <= 11) return h + 12
      if (h === 12 || h === 0) return 0
      if (h >= 1 && h <= 5) return h
      return h >= 21 && h <= 23 ? h : null
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

export type ClockRead = { times: string[]; problem: 'ambiguous_time' | null; hour: number | null }

export function readClock(text: string): ClockRead {
  const found = PERIODS.filter(([, re]) => re.test(text)).map(([p]) => p)
  const period: Period | null = found.length === 1 ? found[0] : null
  let problem: ClockRead['problem'] = found.length > 1 ? 'ambiguous_time' : null
  let hour: number | null = null
  const times = new Set<string>()

  for (const m of text.matchAll(RE_HHMM)) {
    const h = Number(m[1])
    const shifted = period && h >= 1 && h <= 11 ? hourFor(h, period) : h
    if (shifted === null) problem = 'ambiguous_time'
    else times.add(`${pad(shifted)}:${m[2]}`)
  }

  const withoutHhmm = text.replace(RE_HHMM, ' ')
  const bare = (h: number, after: string) => {
    hour = h
    const suffix = RE_SUFFIX.exec(after)
    if (suffix?.[1] === 'פחות') {
      problem = 'ambiguous_time'
      return
    }
    const value = hourFor(h, period)
    if (value === null) {
      problem = 'ambiguous_time'
      return
    }
    const minutes = suffix?.[1] === 'וחצי' ? 30 : suffix?.[1] === 'ורבע' ? 15 : 0
    times.add(`${pad(value)}:${pad(minutes)}`)
  }
  for (const m of withoutHhmm.matchAll(RE_DIGIT_HOUR)) bare(Number(m[1]), withoutHhmm.slice((m.index ?? 0) + m[0].length))
  for (const m of withoutHhmm.matchAll(RE_WORD_HOUR)) bare(HOUR_WORDS[m[1]], withoutHhmm.slice((m.index ?? 0) + m[0].length))

  if (times.size > 1) problem = 'ambiguous_time'
  return { times: [...times], problem, hour }
}
