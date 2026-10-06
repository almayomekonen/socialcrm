/**
 * Optional, deterministic checks on a free-text answer.
 *
 * A text question may declare `validate` in its definition. Without it, any
 * non-empty reply is the answer, exactly as before. With it:
 *
 *   'date'       — an exact or approximate date or period ("18.11.2026",
 *                  "יוני 2027", "סוף דצמבר", "בעוד חודש", "סוף שבוע", "גמיש").
 *                  Impossible numbers ("32.13"), durations without a direction
 *                  ("2 ימים"), phone numbers and prices are not dates.
 *   'meaningful' — anything except an obvious non-answer: punctuation or bare
 *                  numbers, nothing but question words and fillers ("איפה",
 *                  "כן", "אוקי"), a question put to the business ("אתם מגיעים
 *                  לחיפה?"), or a correction of an earlier answer ("טעיתי
 *                  19.11"), which must never become the answer to THIS question.
 *                  Deliberately broad otherwise.
 *
 * `allowNotSet` (with either kind) also accepts an explicit "not decided yet"
 * ("לא נקבע", "עוד לא סגרנו אולם"): a real answer, recorded as `not_set`. Only a
 * reply made of nothing else counts, so "לא יודע עדיין, כנראה יוני" stays a date.
 *
 * Nothing is normalised into a value the customer did not give: the stored
 * answer is always their own words. Nothing here calls a model.
 */
import { aliasTokens } from './aliasMatch'
import { CORRECTIONS_KEY } from './answerKeys'

export type TextValidation = 'date' | 'meaningful'
export type TextCheck = { ok: true; notSet?: true } | { ok: false; reason: 'not_an_answer' | 'question' | 'correction' }
type Rules = { validate?: TextValidation; allowNotSet?: boolean }

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

// ── Dates ───────────────────────────────────────────────────────────────────

const MONTHS = new Set([
  'ינואר', 'פברואר', 'מרץ', 'מרס', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
  'תשרי', 'חשון', 'חשוון', 'מרחשוון', 'כסלו', 'כסליו', 'טבת', 'שבט', 'אדר', 'ניסן', 'אייר', 'סיון', 'סיוון', 'תמוז', 'אלול',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
])
const SEASONS_AND_HOLIDAYS = new Set(['קיץ', 'חורף', 'אביב', 'סתיו', 'פסח', 'סוכות', 'חנוכה', 'פורים', 'שבועות', 'חגים'])
/** Words that are a date or a deliberate "any date" on their own. */
const STANDALONE = new Set(['היום', 'מחר', 'מחרתיים', 'השבוע', 'החודש', 'השנה', 'סופש', 'גמיש', 'גמישה', 'גמישים'])
/** A unit is a date only with a direction: "עוד חודש", "בשבוע הבא". "2 ימים" is a duration. */
const UNITS = new Set(['יום', 'ימים', 'יומיים', 'שבוע', 'שבועות', 'שבועיים', 'חודש', 'חודשים', 'חודשיים', 'שנה', 'שנים', 'שנתיים'])
const DIRECTIONS = new Set(['עוד', 'בעוד', 'תוך', 'הבא', 'הבאה', 'הקרוב', 'הקרובה', 'הזה', 'הזאת', 'סוף'])
/** Weekday names double as ordinary words ("ראשון", "שני"): only after "יום" or before "הבא". */
const WEEKDAYS = new Set(['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'])
/** Spelled out, not prefix-stripped: "מושבת" is not Saturday. */
const SATURDAY = new Set(['שבת', 'בשבת', 'השבת', 'ושבת', 'לשבת', 'מוצש'])

const NUMERIC_DATE = /(?:^|[^\d])(\d{1,2})\s*[./\-\\]\s*(\d{1,2})(?:\s*[./\-\\]\s*(\d{2}|\d{4}))?(?![\d.\-/])/g
const ISO_DATE = /(?:^|[^\d])(?:19|20)\d{2}-\d{1,2}-\d{1,2}(?!\d)/
const YEAR = /(?:^|[^\d])(?:19|20)\d{2}(?!\d)/

function hasNumericDate(text: string): boolean {
  if (ISO_DATE.test(text)) return true
  for (const m of text.matchAll(NUMERIC_DATE)) {
    const day = Number(m[1])
    const month = Number(m[2])
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return true
  }
  return false
}

function isDateLike(text: string, words: readonly string[]): boolean {
  if (hasNumericDate(text) || YEAR.test(text)) return true
  const hasDirection = words.some((w) => inSet(w, DIRECTIONS))
  return words.some((word, i) => {
    if (inSet(word, MONTHS) || inSet(word, SEASONS_AND_HOLIDAYS) || STANDALONE.has(word) || SATURDAY.has(word)) return true
    if (word === 'השנה' && words[i - 1] === 'ראש') return true
    if (word === 'שבוע' && words[i - 1] === 'סוף') return true
    if (word === 'ש' && words[i - 1] === 'סופ') return true // סופ"ש
    if (word === 'שנוח' && words[i - 1] === 'מתי') return true
    // "ה-18 לחודש": a day of the month.
    if (word === 'לחודש' && /^\d{1,2}$/.test(words[i - 1] ?? '')) return true
    if (inSet(word, UNITS)) return hasDirection
    if (WEEKDAYS.has(word)) return inSet(words[i - 1] ?? '', new Set(['יום'])) || inSet(words[i + 1] ?? '', DIRECTIONS)
    return false
  })
}

// ── "Not decided yet" ───────────────────────────────────────────────────────

const NOT_SET_NEGATIONS = new Set(['לא', 'טרם', 'אין'])
const NOT_SET_SUBJECTS = new Set([
  'נקבע', 'נקבעה', 'קבענו', 'קבעו', 'סגור', 'סגורה', 'סגרנו', 'סגרו', 'נסגר', 'החלטנו', 'החלטתי', 'הוחלט',
  'יודע', 'יודעת', 'יודעים', 'ידוע', 'בטוח', 'בטוחה', 'בטוחים', 'תאריך', 'מושג', 'מיקום', 'מקום', 'אולם', 'סופי',
])
/** Words that may surround "not decided" without adding information. */
const NOT_SET_FILLER = new Set([
  'עוד', 'עדיין', 'כרגע', 'בינתיים', 'אני', 'אנחנו', 'לי', 'לנו', 'את', 'זה', 'סופית', 'בדיוק', 'איפה', 'מתי',
  'איזה', 'עיר', 'כבר', 'ממש', 'באמת', 'סגירה', 'סופי',
])

function isNotSet(words: readonly string[]): boolean {
  const all = (w: string) => inSet(w, NOT_SET_NEGATIONS) || inSet(w, NOT_SET_SUBJECTS) || inSet(w, NOT_SET_FILLER)
  if (!words.length || !words.every(all)) return false
  return words.some((word, i) => inSet(word, NOT_SET_NEGATIONS) && words.slice(i + 1, i + 4).some((n) => inSet(n, NOT_SET_SUBJECTS)))
}

// ── Non-answers, questions, corrections ─────────────────────────────────────

/** Replies that say nothing on their own, whatever the question was. */
const NON_ANSWERS = new Set([
  'מה', 'מתי', 'איפה', 'למה', 'איך', 'מי', 'כמה', 'כן', 'לא', 'אוקי', 'אוקיי', 'ok', 'okay', 'טוב', 'בסדר', 'סבבה',
  'יופי', 'תודה', 'הבנתי', 'שלום', 'היי', 'הי', 'אהלן', 'רגע', 'אממ', 'אמ', 'המ', 'תאריך', 'מיקום', 'עיר', 'מקום',
  'שירות', 'אירוע', 'אחר', 'משהו', 'נציג', 'אני', 'רוצה', 'צריך', 'בלי', 'יודע', 'יודעת', 'יודעים', 'זה', 'מעוניין',
  'מעוניינת', 'מעוניינים', 'רלוונטי', 'עולה', 'עולים', 'מחיר', 'מחירים',
])
const INTERROGATIVES = new Set(['מה', 'למה', 'איך', 'האם', 'מתי', 'איפה', 'מי', 'כמה'])
/** Opening a reply, these ask. "כמה" is not among them: "כמה מקומות" is an answer. */
const OPENING_INTERROGATIVES = new Set(['מה', 'למה', 'איך', 'האם', 'מתי', 'איפה', 'מי'])
/** Openers that put a question to the business: "אתם מגיעים…?", "אפשר…?". */
const ASKING_OPENERS = new Set(['אתם', 'אפשר', 'תוכלו', 'יש'])
const CORRECTION_MARKERS = new Set(['טעיתי', 'טעות', 'תיקון', 'התכוונתי', 'בעצם'])

/** A question put to us, rather than an answer to ours. */
export function isQuestionToUs(text: string, words: readonly string[]): boolean {
  if (!words.length) return false
  if (OPENING_INTERROGATIVES.has(words[0]) && words.length > 1) return true
  if (!/[?؟]/.test(text)) return false
  return ASKING_OPENERS.has(words[0]) || words.some((w) => INTERROGATIVES.has(w))
}

export function isCorrection(words: readonly string[]): boolean {
  return words.some((w) => CORRECTION_MARKERS.has(w))
}

export function checkTextAnswer(rules: Rules, value: string): TextCheck {
  if (!rules.validate) return { ok: true }
  const words = aliasTokens(value)
  if (rules.validate === 'date') {
    if (isDateLike(value, words)) return { ok: true }
    if (rules.allowNotSet && isNotSet(words)) return { ok: true, notSet: true }
    return { ok: false, reason: isCorrection(words) ? 'correction' : 'not_an_answer' }
  }
  if (rules.allowNotSet && isNotSet(words)) return { ok: true, notSet: true }
  if (isCorrection(words)) return { ok: false, reason: 'correction' }
  if (isQuestionToUs(value, words)) return { ok: false, reason: 'question' }
  const meaningful = words.filter((w) => !/^\d+$/.test(w) && !inSet(w, NON_ANSWERS))
  return meaningful.length ? { ok: true } : { ok: false, reason: 'not_an_answer' }
}

/** Keep any correction among these replies, once each, for the rep. */
export function withCorrections(answers: Record<string, string[]>, texts: readonly string[]): Record<string, string[]> {
  const prior = answers[CORRECTIONS_KEY] ?? []
  const found = texts
    .map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 300))
    .filter((t) => t && isCorrection(aliasTokens(t)) && !prior.includes(t))
  return found.length ? { ...answers, [CORRECTIONS_KEY]: [...prior, ...found] } : answers
}
