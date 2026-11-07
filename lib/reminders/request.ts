/**
 * A personal-reminder request in the owner's own Hebrew words (Reminder Engine
 * Phase 6). Pure: no clock, no database, no model.
 *
 *   create      "בעוד 5 דקות תזכיר לי להתקשר לאבי", "תזכורת לבדוק את ההצעה מחר ב-9"
 *   list        "אילו תזכורות יש לי?", "מה התזכורות שלי"
 *   cancel      "תבטל את התזכורת להתקשר לאבי"
 *   reschedule  "תזיז את התזכורת להתקשר לאבי ל-16:00"
 *
 * ROUTING (architecture v1.1 decision 1, approved): with the reminders switch on,
 * "תזכיר לי" is a personal reminder. A message that names a CRM task or follow-up
 * ("משימה", "מעקב") is NOT, and keeps going to tasks exactly as before.
 *
 * The WHEN is never read here: lib/reminders/when.ts reads it, from the owner's
 * words and Meta's verified timestamp. This file only removes the time words
 * from the reminder TEXT, and merges an answer into a pending request.
 */
import { readClock } from './clock'
import { readOffsets } from './offset'
import { readDates } from '@/lib/waAssistant/meetings/when'

export type ReminderIntent = 'create' | 'list' | 'cancel' | 'reschedule'

const B = '(?<![\\p{L}])'
const E = '(?![\\p{L}])'
const re = (src: string, flags = 'u') => new RegExp(src, flags)

const MENTIONS = re(`${B}[ולה]?תזכור(?:ת|ות)${E}`)
const CRM_WORDS = re(`${B}[ולה]?(?:משימ\\p{L}*|מעקב)${E}`)
const CREATE = re(`${B}(?:תזכיר(?:י|ו)?|הזכר(?:י|ו)?|תזכרי)\\s+לי${E}`)
const CANCEL_VERBS = '(?:ת?בטל(?:י|ו)?|לבטל|ת?מחק(?:י|ו)?|למחוק|תוריד(?:י)?|להוריד)'
const RESCHEDULE_VERBS = '(?:תזיז(?:י|ו)?|להזיז|הזז(?:י)?|תדחה|תדחי|לדחות|דחה|תשנה|תשני|לשנות|שנה|תעביר(?:י)?|להעביר)'
const CANCEL = re(`${B}${CANCEL_VERBS}${E}`)
const RESCHEDULE = re(`${B}${RESCHEDULE_VERBS}${E}`)
const LIST_CUE = re(`${B}(?:מה|אילו|איזה|איזו|כמה|תראה|תראי|הראה|תציג|הצג|רשימ\\p{L}*|יש|שלי|קרובות|הקרובות|מתוזמנות)${E}`)

export function reminderIntent(text: string): ReminderIntent | null {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t || CRM_WORDS.test(t)) return null
  const mentions = MENTIONS.test(t)
  if (mentions && CANCEL.test(t)) return 'cancel'
  if (mentions && RESCHEDULE.test(t)) return 'reschedule'
  if (CREATE.test(t)) return 'create'
  if (/(?:^|[^\p{L}])[ולה]?תזכורות(?![\p{L}])/u.test(t) && LIST_CUE.test(t)) return 'list'
  if (/^\s*(?:ה)?תזכורות(?:\s+שלי)?[\s?.!]*$/u.test(t)) return 'list'
  if (mentions && /(?:^|[^\p{L}])(?:ה)?תזכורת\s+ל\p{L}/u.test(t)) return 'create'
  if (/^\s*(?:ת?קבע(?:י)?|צור(?:י)?|תיצור(?:י)?)\s+(?:לי\s+)?תזכורת/u.test(t)) return 'create'
  return null
}

const HOUR_WORDS = 'אחת עשרה|שתים עשרה|שתיים עשרה|שתיים|שתים|שמונה|ארבע|שלוש|אחת|חמש|שבע|תשע|עשר|שש'
const NUMBERISH = '\\d{1,4}|\\p{L}+'
const OFFSET = `[וש]?בעוד\\s+(?:(?:רבע|חצי|שלושת רבעי|שלושה רבעי)\\s+שעה|(?:(?:${NUMBERISH})\\s+)?(?:דקות|דקה|שעות|שעה|שעתיים)(?:\\s+(?:וחצי|ורבע))?(?:\\s+ו[-־]?\\s?(?:${NUMBERISH})\\s+(?:דקות|דקה))?|(?:(?:${NUMBERISH})\\s+)?(?:ימים|יום|יומיים|שבועות|שבוע|שבועיים))`
const HHMM = `(?:ב[-־–]?\\s?|בשעה\\s+|ל[-־–]?\\s?|לשעה\\s+)?\\d{1,2}:\\d{2}`
const DIGIT_HOUR = `(?:ב[-־–]?\\s?|בשעה\\s+|ל[-־–]\\s?|לשעה\\s+)\\d{1,2}(?![\\d:./])(?:\\s+(?:וחצי|ורבע))?`
const WORD_HOUR = `(?:ב|בשעה\\s+|לשעה\\s+)(?:${HOUR_WORDS})${E}(?:\\s+(?:וחצי|ורבע|פחות רבע))?`
const PERIOD = `(?:בבוקר|בצהריים|אחה["״']?צ|אחר(?:י)? הצהריים|בערב|בלילה)`
const DATE = `(?:היום|מחרתיים|מחר|ב?יום\\s+(?:ראשון|שני|שלישי|רביעי|חמישי|שישי)|בשבת|\\d{1,2}[./]\\d{1,2}(?:[./]\\d{2,4})?)`

const strip = (text: string, parts: string[]) => parts.reduce((t, p) => t.replace(re(`${B}${p}${E}`, 'gu'), ' '), text)

/** The text without its clock times and offsets (dates kept). */
export const stripTimes = (text: string) => strip(text, [OFFSET, HHMM, DIGIT_HOUR, WORD_HOUR, PERIOD]).replace(/\s+/g, ' ').trim()
/** The text without its dates. */
export const stripDates = (text: string) => strip(text, [DATE]).replace(/\s+/g, ' ').trim()

const TRIGGERS = [
  `(?:תזכיר(?:י|ו)?|הזכר(?:י|ו)?|תזכרי)\\s+לי`,
  `(?:ת?קבע(?:י)?|צור(?:י)?|תיצור(?:י)?)\\s+(?:לי\\s+)?תזכורת`,
  `(?:ה)?תזכורת`,
  `(?:בבקשה|תודה|בבקשה תודה)`,
]
const EDGES = /^[\s,.:;\-–—"'״׳]+|[\s,.:;\-–—!?"'״׳]+$/gu

/** What the owner asked to be reminded of, without the trigger and time words. "" when they said nothing else. */
export function reminderText(text: string): string {
  const once = strip(text.replace(/\s+/g, ' '), TRIGGERS)
  return stripDates(stripTimes(once)).replace(/^(?:ש|על|את)\s+/u, '').replace(EDGES, '').replace(/\s+/g, ' ').trim()
}

/**
 * An answer to a pending WHEN question merged into the request it answers: the
 * answer's own time replaces the request's, and its own date the request's.
 * "היום בתשע" + "בתשע בערב" → "היום בתשע בערב"; "תזכיר לי מחר …" + "בתשע" keeps "מחר".
 */
export function mergeWhen(request: string, answer: string, today: string): string {
  const clock = readClock(answer)
  const offsets = readOffsets(answer)
  const hasTime = clock.times.length > 0 || clock.problem !== null || offsets.minutes.length > 0 || offsets.problem !== null
  const hasDate = readDates(answer, today).dates.length > 0
  let base = request
  if (hasTime) base = stripTimes(base)
  if (hasDate || offsets.minutes.length > 0) base = stripDates(base)
  return `${base} ${answer}`.replace(/\s+/g, ' ').trim()
}

/** Does `answer` say anything about when (a day, a time, a period, an offset)? */
export function mentionsWhen(answer: string, today: string): boolean {
  return stripDates(stripTimes(answer)) !== answer.replace(/\s+/g, ' ').trim() || readDates(answer, today).dates.length > 0
}

const TARGET_NOISE = [CANCEL_VERBS, RESCHEDULE_VERBS, '(?:את|של|שלי|לי|בבקשה|תודה)', '[ולה]?תזכורת']

/** The words that name WHICH reminder ("להתקשר לאבי"), with the verb, "התזכורת" and every time removed. */
export function targetPhrase(text: string): string {
  return stripDates(stripTimes(strip(text.replace(/\s+/g, ' '), TARGET_NOISE))).replace(EDGES, '').replace(/\s+/g, ' ').trim()
}

/** "של 14:35" / "מ-14:35": the time that names WHICH reminder to move, as HH:MM. */
export function targetTime(text: string): { time: string | null; rest: string } {
  const m = re(`${B}(?:של\\s+|מ[-־–]?\\s?|משעה\\s+)(?:השעה\\s+)?(\\d{1,2}):(\\d{2})(?!\\d)`).exec(text)
  if (!m) return { time: null, rest: text }
  return { time: `${m[1].padStart(2, '0')}:${m[2]}`, rest: `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').trim() }
}

/** Letters and digits only, for "does this reminder's text contain what the owner said?". */
export const squash = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '')
