/**
 * Optional, deterministic checks on a free-text answer.
 *
 * A text question may declare `validate` in its definition. Without it, any
 * non-empty reply is the answer, exactly as before. With it:
 *
 *   'date'       — an exact or approximate date or period ("18.11.2026",
 *                  "יוני 2027", "סוף דצמבר", "בעוד חודש"), or an explicit "not
 *                  decided yet" ("לא נקבע", "עדיין אין תאריך"), which is a real
 *                  answer and is recorded as the state `not_set`. Anything else
 *                  ("לתאריך", "מה", "?") is not an answer and is re-asked.
 *   'meaningful' — anything except an obvious non-answer: punctuation only, or
 *                  nothing but question words, fillers or the topic word itself
 *                  ("איפה", "מיקום", "כן", "אוקי"). Deliberately broad.
 *
 * Nothing is normalised into a date the customer did not give: the stored
 * answer is always their own words. Nothing here calls a model.
 */
import { aliasTokens } from './aliasMatch'

export type TextValidation = 'date' | 'meaningful'
export type TextCheck = { ok: true; notSet?: true } | { ok: false }

const PREFIX_RE = /^[והבלמשכ]{1,2}/

/** The word itself, or the word without up to two Hebrew prefix letters. */
function inSet(word: string, set: ReadonlySet<string>): boolean {
  if (set.has(word)) return true
  const m = PREFIX_RE.exec(word)
  if (!m) return false
  for (let cut = 1; cut <= m[0].length; cut++) {
    if (set.has(word.slice(cut))) return true
  }
  return false
}

const MONTHS = new Set([
  'ינואר', 'פברואר', 'מרץ', 'מרס', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
  'תשרי', 'חשון', 'חשוון', 'מרחשוון', 'כסלו', 'כסליו', 'טבת', 'שבט', 'אדר', 'ניסן', 'אייר', 'סיון', 'סיוון', 'תמוז', 'אלול',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
])
const SEASONS_AND_HOLIDAYS = new Set(['קיץ', 'חורף', 'אביב', 'סתיו', 'פסח', 'סוכות', 'חנוכה', 'פורים', 'שבועות', 'חגים'])
/** A day word that is a date on its own. */
const RELATIVE_DAYS = new Set(['היום', 'מחר', 'מחרתיים', 'השבוע', 'החודש', 'השנה'])
/** A unit is a date only with a quantity or a direction: "עוד חודש", "בשבוע הבא", "3 חודשים". */
const UNITS = new Set(['יום', 'ימים', 'יומיים', 'שבוע', 'שבועות', 'שבועיים', 'חודש', 'חודשים', 'חודשיים', 'שנה', 'שנים', 'שנתיים'])
const UNIT_QUALIFIERS = new Set(['עוד', 'בעוד', 'תוך', 'הבא', 'הבאה', 'הקרוב', 'הקרובה', 'הזה', 'הזאת'])
/** Weekday names double as ordinary words ("ראשון", "שני"), so only after "יום" or before "הבא". */
const WEEKDAYS = new Set(['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'])
const DAY_WORD = new Set(['יום'])

const NUMERIC_DATE = /(?:^|\D)\d{1,2}\s*[./\-\\]\s*\d{1,2}(?:\s*[./\-\\]\s*\d{2,4})?(?!\d)/
const YEAR = /(?:^|\D)(?:19|20)\d{2}(?!\d)/

function isDateLike(text: string, words: readonly string[]): boolean {
  if (NUMERIC_DATE.test(text) || YEAR.test(text)) return true
  const hasNumber = /\d/.test(text)
  return words.some((word, i) => {
    if (inSet(word, MONTHS) || inSet(word, SEASONS_AND_HOLIDAYS) || RELATIVE_DAYS.has(word)) return true
    if (word === 'השנה' && words[i - 1] === 'ראש') return true
    if (inSet(word, UNITS)) return hasNumber || words.some((w) => UNIT_QUALIFIERS.has(w))
    if (inSet(word, new Set(['שבת']))) return true
    if (WEEKDAYS.has(word)) return inSet(words[i - 1] ?? '', DAY_WORD) || UNIT_QUALIFIERS.has(words[i + 1] ?? '')
    return false
  })
}

/** "Not decided yet": a negation followed by what is undecided or unknown. */
const NOT_SET_NEGATIONS = new Set(['לא', 'טרם', 'אין'])
const NOT_SET_SUBJECTS = new Set([
  'נקבע', 'נקבעה', 'קבענו', 'קבעו', 'סגור', 'סגורה', 'סגרנו', 'סגרו', 'נסגר', 'החלטנו', 'החלטתי', 'הוחלט',
  'יודע', 'יודעת', 'יודעים', 'ידוע', 'בטוח', 'בטוחה', 'בטוחים', 'תאריך', 'מושג',
])

function isNotSet(words: readonly string[]): boolean {
  return words.some((word, i) => {
    if (!inSet(word, NOT_SET_NEGATIONS)) return false
    return words.slice(i + 1, i + 4).some((next) => inSet(next, NOT_SET_SUBJECTS))
  })
}

/** Replies that say nothing on their own, whatever the question was. */
const NON_ANSWERS = new Set([
  'מה', 'מתי', 'איפה', 'למה', 'איך', 'מי', 'כמה', 'כן', 'לא', 'אוקי', 'אוקיי', 'ok', 'okay', 'טוב', 'בסדר', 'סבבה',
  'יופי', 'תודה', 'הבנתי', 'שלום', 'היי', 'הי', 'אהלן', 'רגע', 'אממ', 'אמ', 'המ', 'תאריך', 'מיקום', 'עיר', 'מקום',
  'שירות', 'אירוע', 'אחר', 'משהו',
])

export function checkTextAnswer(kind: TextValidation | undefined, value: string): TextCheck {
  if (!kind) return { ok: true }
  const words = aliasTokens(value)
  if (kind === 'date') {
    if (isDateLike(value, words)) return { ok: true }
    if (isNotSet(words)) return { ok: true, notSet: true }
    return { ok: false }
  }
  if (!words.length || words.every((w) => inSet(w, NON_ANSWERS))) return { ok: false }
  return { ok: true }
}
