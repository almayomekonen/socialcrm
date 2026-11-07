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

export type ReminderIntent = 'create' | 'list' | 'cancel' | 'reschedule' | 'capability'

const B = '(?<![\\p{L}])'
const E = '(?![\\p{L}])'
const re = (src: string, flags = 'u') => new RegExp(src, flags)

const MENTIONS = re(`${B}[ולה]?תזכור(?:ת|ות)${E}`)
const CRM_WORD = '[ולה]?(?:משימ\\p{L}*|מעקב)'
const CRM_WORDS = re(`${B}${CRM_WORD}${E}`)
/** "לא משימה", "בלי מעקב": the owner saying what this is NOT. Never a reason to route to tasks. */
const NEGATED_CRM_SRC = `${B}(?:לא|בלי|אין)\\s+(?:זו\\s+|זה\\s+)?${CRM_WORD}${E}`
const NEGATED_CRM = re(NEGATED_CRM_SRC)
/** Global twin, for `replace` only (a global regex carries `lastIndex` between `test` calls). */
const NEGATED_CRM_ALL = re(NEGATED_CRM_SRC, 'gu')
const REMIND_VERB = '(?:תזכיר(?:י|ו)?|הזכר(?:י|ו)?|תזכרי)'
/**
 * An action said as an infinitive right after "תזכיר" ("תזכיר להתקשר", "תזכיר לבדוק"):
 * the hif'il/hitpa'el "לה…" forms, and the common short ones. A NAME after "תזכיר"
 * ("תזכיר לדני …") is not one: that is a message to someone, never a personal reminder.
 */
const ACTION = 'ל(?:ה\\p{L}{2,}|בדוק|שלוח|חזור|קנות|צאת|דבר|כתוב|עדכן|סגור|שלם|אסוף|קבוע|בקש|תאם|פגוש|שאול|ענות|סיים|ברר|קחת|תת|אכול|נסוע|לכת|בוא|הגיע)'
const CREATE = re(`${B}(?:${REMIND_VERB}\\s+לי|${REMIND_VERB}(?=\\s+${ACTION}${E}))${E}`)
const CANCEL_VERBS = '(?:ת?בטל(?:י|ו)?|לבטל|ת?מחק(?:י|ו)?|למחוק|תוריד(?:י)?|להוריד)'
const RESCHEDULE_VERBS = '(?:תזיז(?:י|ו)?|להזיז|הזז(?:י)?|תדחה|תדחי|לדחות|דחה|תשנה|תשני|לשנות|שנה|תעביר(?:י)?|להעביר)'
const CANCEL = re(`${B}${CANCEL_VERBS}${E}`)
const RESCHEDULE = re(`${B}${RESCHEDULE_VERBS}${E}`)
const CAPABILITY = re(`${B}(?:יכול|יכולה|יודע|יודעת|אפשר|ניתן)${E}`)
/** Right after a reminder action: "בעצם תבטל אותה", "ביטלת?", "זה נקבע?". */
const STATUS_QUESTION = re(`${B}(?:ביטלת|בוטל|בוטלה|קבעת|נקבע|נקבעה|הזזת|הוזז|הוזזה|נשלח|נשלחה|בתוקף|עדיין)${E}`)

/**
 * A short follow-up that refers back to the reminder just handled, with no
 * reminder word of its own. Only consulted while a reminder action is the
 * conversation's last step (../waAssistant/reminders/conversation.ts).
 */
export function followUpIntent(text: string): ReminderIntent | null {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t || CRM_WORDS.test(t)) return null
  if (CANCEL.test(t)) return 'cancel'
  if (RESCHEDULE.test(t)) return 'reschedule'
  if (STATUS_QUESTION.test(t)) return 'list'
  return null
}

const LIST_CUE = re(`${B}(?:מה|אילו|איזה|איזו|כמה|תראה|תראי|הראה|תציג|הצג|רשימ\\p{L}*|יש|שלי|קרובות|הקרובות|מתוזמנות)${E}`)

/** Does the text ask to be reminded at all ("תזכיר", "הזכר", "תזכורת"), whatever followed? */
export function mentionsReminder(text: string): boolean {
  return MENTIONS.test(text) || re(`${B}${REMIND_VERB}${E}`).test(text)
}

/** "לא משימה! תזכורת": the owner correcting us. A reminder word, and every CRM word negated. */
export function isReminderCorrection(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!NEGATED_CRM.test(t)) return false
  const rest = t.replace(NEGATED_CRM_ALL, ' ')
  return MENTIONS.test(rest) && !CRM_WORDS.test(rest) && !/(?:^|[^\p{L}])(?:לא|בלי)\s+[ולה]?תזכור/u.test(t)
}

export function reminderIntent(text: string): ReminderIntent | null {
  const t = text.replace(/\s+/g, ' ').trim().replace(NEGATED_CRM_ALL, ' ').replace(/\s+/g, ' ').trim()
  if (!t || CRM_WORDS.test(t)) return null
  const mentions = MENTIONS.test(t)
  if (mentions && CANCEL.test(t)) return 'cancel'
  if (mentions && RESCHEDULE.test(t)) return 'reschedule'
  if (CREATE.test(t)) return 'create'
  if (/(?:^|[^\p{L}])[ולה]?תזכורות(?![\p{L}])/u.test(t) && LIST_CUE.test(t)) return 'list'
  if (/^\s*(?:ה)?תזכורות(?:\s+שלי)?[\s?.!]*$/u.test(t)) return 'list'
  if (mentions && /(?:^|[^\p{L}])(?:ה)?תזכורת\s+ל\p{L}/u.test(t)) return 'create'
  if (/^\s*(?:ת?קבע(?:י)?|צור(?:י)?|תיצור(?:י)?)\s+(?:לי\s+)?תזכורת/u.test(t)) return 'create'
  // Anything else that talks about reminders ("כתבת לי שיש תזכורת ב-20:30", "ביטלת את
  // התזכורת?") is answered from the owner's actual reminders, never by the Agent;
  // a question about what is possible gets the capability answer.
  if (mentions) return CAPABILITY.test(t) ? 'capability' : 'list'
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
  `${REMIND_VERB}\\s+לי`,
  REMIND_VERB,
  `(?:ת?קבע(?:י)?|צור(?:י)?|תיצור(?:י)?)\\s+(?:לי\\s+)?תזכורת`,
  `(?:ה)?תזכורת`,
  `(?:בבקשה|תודה|בבקשה תודה)`,
]
const EDGES = /^[\s,.:;!?\-–—"'״׳]+|[\s,.:;\-–—!?"'״׳]+$/gu

/** What the owner asked to be reminded of, without the trigger and time words. "" when they said nothing else. */
export function reminderText(text: string): string {
  const once = strip(text.replace(/\s+/g, ' ').replace(NEGATED_CRM_ALL, ' '), TRIGGERS)
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

const TARGET_NOISE = [CANCEL_VERBS, RESCHEDULE_VERBS, '(?:את|של|שלי|לי|בבקשה|תודה)', '[ולה]?תזכורת', '(?:אותה|אותו|אותן|אותם|זאת|הזאת|הזו|הזה|בעצם|רגע|אז|כן|אוקי|אוקיי)']

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
