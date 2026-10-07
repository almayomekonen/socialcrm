/**
 * "למה המערכת בחרה בזה?" in the owner's words.
 *
 * Reads the simulator's TurnExplanation (simulate.ts), which is read off the
 * production decision, and says it in Hebrew. It decides nothing; a reason this
 * map does not know is still shown, in a generic sentence, never hidden.
 */
import { NOT_SET_SUMMARY } from '../render'
import { keyOf, optionsOf } from './editorBase'
import { questionName } from './conditionText'
import type { BuilderQuestionnaire } from './model'
import type { TurnExplanation } from './simulate'

const REASONS: Record<string, string> = {
  started: 'הודעה ראשונה מהלקוח, ולכן השאלון התחיל.',
  restarted: 'הלקוח ביקש להתחיל מחדש.',
  answered: 'התשובה זוהתה, ולכן נשאלה השאלה הבאה.',
  completed: 'כל השאלות נענו, ולכן נשלחה הודעת הסיום.',
  customer_question: 'הלקוח שאל שאלה. היא נשמרה לנציג, והשאלה נשאלה שוב.',
  customer_questions: 'הלקוח שאל כמה שאלות, ולכן השיחה הועברה לנציג.',
  early_messages: 'ההודעה נשמרה לנציג. השאלה הנוכחית עדיין פתוחה.',
  ignorable_only: 'ההודעה לא דרשה תגובה.',
  human_request: 'הלקוח ביקש נציג, ולכן השיחה הועברה לנציג.',
  declined: 'הלקוח לא רצה להמשיך, ולכן השיחה הועברה לנציג בלי הודעה נוספת.',
  opt_out: 'הלקוח ביקש להפסיק לקבל הודעות. לא נשלח דבר.',
  invalid_limit: 'התשובה לא זוהתה כמה פעמים, ולכן השיחה הועברה לנציג.',
  expired: 'עבר יותר מדי זמן מאז השאלה האחרונה, ולכן השיחה הועברה לנציג.',
  session_closed: 'השאלון כבר הסתיים. הודעות נוספות מגיעות לנציג.',
  reprompt_invalid_choice: 'התשובה לא התאימה לאף אפשרות, ולכן השאלה נשאלה שוב.',
  reprompt_invalid_multi: 'בשאלה הזו אפשר לבחור אפשרות אחת בלבד.',
  reprompt_invalid_text: 'התשובה לא נראתה כמו תשובה לשאלה, ולכן השאלה נשאלה שוב.',
  reprompt_media: 'הלקוח שלח קובץ ולא טקסט.',
  reprompt_voice: 'הלקוח שלח הודעה קולית.',
}

export function explainReason(e: TurnExplanation): string {
  return REASONS[e.reason] ?? 'המערכת לא שלחה הודעה בתור הזה.'
}

/** One line per answer the turn recorded: "סוג האירוע: חתונה (מתוך: אנחנו מתחתנים)". */
export function explainRecognized(m: BuilderQuestionnaire, e: TurnExplanation): string[] {
  return e.recognized.map((r) => {
    const q = m.questions.find((x) => keyOf(x) === r.questionId)
    const name = q ? questionName(q) : 'שאלה'
    let value: string
    if (r.notSet) value = NOT_SET_SUMMARY
    else if (r.optionIds) {
      value = r.optionIds.map((id) => (q ? optionsOf(q).find((o) => keyOf(o) === id)?.label : undefined) ?? id).join(', ')
    } else value = r.text ?? ''
    const words = r.fromWords && r.optionIds ? ` (זוהה מתוך: "${r.fromWords}")` : ''
    return `${name}: ${value}${words}`
  })
}

/** What the turn kept aside for the נציג instead of using as an answer. */
export function explainKept(e: TurnExplanation): string[] {
  return [
    ...e.keptForRep.questions.map((t) => `שאלה מהלקוח, נשמרה לנציג: "${t}"`),
    ...e.keptForRep.corrections.map((t) => `תיקון מהלקוח, סומן לנציג: "${t}"`),
    ...e.keptForRep.unplaced.map((t) => `הודעה נוספת, נשמרה לנציג: "${t}"`),
  ]
}
