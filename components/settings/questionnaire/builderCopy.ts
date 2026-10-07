/**
 * The Builder's words. No engine term reaches the screen: kinds, checks and
 * failure reasons are all said here, once, in the owner's Hebrew.
 *
 * Pure data, importable from server and client components alike.
 */
import type { QuestionKind } from '@/lib/inbox/autoresponse/questionnaire/builder/editorOps'

/** "איך הלקוח יכול לענות" — the three V1 question types. */
export type AnswerType = 'single' | 'multi' | 'free'

export const ANSWER_TYPES: Array<{ value: AnswerType; label: string; hint: string }> = [
  { value: 'single', label: 'בחירה של תשובה אחת', hint: 'הלקוח בוחר אפשרות אחת מתוך רשימה ממוספרת' },
  { value: 'multi', label: 'בחירה של כמה תשובות', hint: 'הלקוח יכול לבחור יותר מאפשרות אחת, למשל: 1,3' },
  { value: 'free', label: 'תשובה חופשית', hint: 'הלקוח כותב תשובה במילים שלו' },
]

export function answerTypeOf(kind: QuestionKind): AnswerType {
  if (kind === 'single_choice') return 'single'
  if (kind === 'multi_choice') return 'multi'
  return 'free'
}

/**
 * "בדיקת התשובה" for free-text questions. `location` is a Builder preset over
 * the same runtime check as `meaningful` (a real answer, not "ok" or "?"),
 * with location wording; the runtime has no separate location check.
 */
export type TextCheck = 'none' | 'date' | 'meaningful' | 'location'

export const TEXT_CHECKS: Array<{ value: TextCheck; label: string; hint: string }> = [
  { value: 'none', label: 'ללא בדיקה מיוחדת', hint: 'כל תשובה בטקסט מתקבלת' },
  { value: 'date', label: 'תאריך', hint: 'המערכת מוודאת שנכתב תאריך או תקופה, למשל "15.8" או "באוגוסט"' },
  { value: 'meaningful', label: 'תשובה משמעותית', hint: 'המערכת מוודאת שנכתבה תשובה אמיתית, ולא רק "אוקיי" או "?"' },
  { value: 'location', label: 'מיקום / מקום', hint: 'עיר, אזור או שם של מקום. נבדק כמו תשובה משמעותית' },
]

export function textCheckOf(kind: QuestionKind): TextCheck {
  if (kind === 'date') return 'date'
  if (kind === 'text') return 'meaningful'
  return 'none'
}

export const LOCATION_PRESET = {
  notUnderstood: 'לא הצלחנו לזהות מיקום 📍\nאפשר לכתוב עיר, אזור או שם של מקום. אם עדיין לא נקבע, כתבו: לא נקבע',
}

export const DATE_PRESET = {
  notUnderstood: 'לא הצלחנו לזהות תאריך 📅\nאפשר לכתוב תאריך מדויק או משוער. אם עדיין לא נקבע תאריך, כתבו: לא נקבע',
}

export const SAVE_STATUS: Record<'idle' | 'saving' | 'saved' | 'error', string> = {
  idle: '',
  saving: 'שומר…',
  saved: 'נשמר',
  error: 'השמירה נכשלה. השינויים שמורים בחלון הזה וננסה שוב.',
}

export const CONFLICT_COPY = {
  changed_elsewhere: 'הטיוטה השתנתה בחלון או במכשיר אחר. כדי לא לדרוס את השינויים שם, השמירה האוטומטית נעצרה.',
  published_elsewhere: 'הטיוטה פורסמה מחלון אחר. כדי לא לדרוס את הגרסה שפורסמה, השמירה האוטומטית נעצרה.',
  gone: 'הטיוטה נמחקה מחלון אחר, ולכן השמירה האוטומטית נעצרה.',
} as const

export const FAILURE_COPY: Record<string, string> = {
  forbidden: 'אין לך הרשאה לערוך את השאלון.',
  history_missing: 'לשאלון הקיים חסרה היסטוריית גרסאות, ולכן אי אפשר לערוך אותו כאן. פנו אלינו ונסדר את זה.',
}

export const PUBLISH_COPY: Record<string, string> = {
  not_ready: 'לפני הפרסום צריך לתקן כמה דברים בשאלון. הם מסומנים למטה.',
  invalid: 'לפני הפרסום צריך לתקן כמה דברים בשאלון. הם מסומנים למטה.',
  draft_out_of_date: 'מאז שהטיוטה נפתחה פורסמה גרסה אחרת. כדי לא לבטל אותה, צרו טיוטה מהגרסה העדכנית.',
  version_conflict: 'הטיוטה השתנתה בחלון אחר. טענו את הגרסה העדכנית לפני הפרסום.',
  forbidden: 'אין לך הרשאה לפרסם את השאלון.',
}

export const SIMULATE_COPY: Record<string, string> = {
  not_ready: 'כדי לבדוק את השאלון צריך קודם לתקן את מה שמסומן בעורך.',
  too_long: 'שיחת הבדיקה ארוכה מדי. התחילו שיחה חדשה.',
  not_found: 'אין עדיין שאלון לבדיקה.',
  forbidden: 'אין לך הרשאה לבדוק את השאלון.',
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

/**
 * What else changes when something others depend on is removed. Null when
 * nothing does, so the removal needs no confirmation.
 */
export function consequenceText(deps: { questions: string[]; endings: number[] }): string | null {
  const parts: string[] = []
  const q = deps.questions.length
  const e = deps.endings.length
  if (q)
    parts.push(
      q === 1 ? 'שאלה אחת מופיעה לפי התשובה הזו, והתנאי שלה יעודכן.' : `${q} שאלות מופיעות לפי התשובה הזו, והתנאים שלהן יעודכנו.`,
    )
  if (e)
    parts.push(
      e === 1
        ? 'סיום שונה אחד תלוי בתשובה הזו, והוא יעודכן או יימחק.'
        : `${e} סיומים שונים תלויים בתשובה הזו, והם יעודכנו או יימחקו.`,
    )
  return parts.length ? parts.join('\n') : null
}

export type ConfirmRequest = { msg: string; confirmLbl: string; destructive?: boolean; run: () => void }

export type LiveRouting = { routedToQuestionnaire: boolean; channelEnabled: boolean; masterEnabled: boolean }

/**
 * Where the questionnaire stands, in one honest line. Publishing is not
 * switching on (PR1): a published questionnaire that is not the WhatsApp
 * responder says so, and the line never claims customers receive something
 * they do not.
 */
export function liveStatusText(liveRevision: number | null, routing: LiveRouting): string {
  if (liveRevision === null) return 'השאלון עוד לא פורסם. הלקוחות לא מקבלים אותו.'
  const answering = routing.routedToQuestionnaire && routing.channelEnabled && routing.masterEnabled
  if (answering) return `גרסה ${liveRevision} עונה לפניות חדשות בוואטסאפ.`
  if (routing.routedToQuestionnaire)
    return `גרסה ${liveRevision} פורסמה, אבל המענה האוטומטי כבוי כרגע, ולכן הלקוחות לא מקבלים אותה.`
  return `גרסה ${liveRevision} פורסמה, אבל השאלון עוד לא מופעל בוואטסאפ. להפעלה, פנו אלינו.`
}
