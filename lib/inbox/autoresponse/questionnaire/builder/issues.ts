/**
 * Builder issues in the owner's language.
 *
 * The same pattern as the automation builder's `ERRORS` map
 * (components/settings/automations/sheetOptions.ts): the server returns codes,
 * people read Hebrew. Names questions and options by their labels, never by id.
 */
import type { BuilderIssue } from './checks'
import type { BuilderQuestionnaire } from './model'

const FIELD: Record<string, string> = {
  opening: 'הודעת הפתיחה',
  standardEnding: 'הודעת הסיום',
  handoffMessage: 'ההודעה כשמעבירים לנציג',
  summaryTitle: 'כותרת הסיכום',
  prompt: 'נוסח השאלה',
  label: 'שם השאלה',
  message: 'הודעת הסיום המותאמת',
  phrasings: 'הניסוחים',
  icon: 'האייקון',
  notUnderstood: 'ההודעה כשלא הבנו את התשובה',
  askAgainAfterQuestion: 'הנוסח לשאול שוב',
}

export function describeIssue(issue: BuilderIssue, questionnaire: BuilderQuestionnaire): string {
  const q = questionnaire.questions.find((x) => x.id === issue.questionId)
  const question = q ? `"${q.prompt || q.label || 'שאלה ללא נוסח'}"` : 'השאלון'
  const options = q && (q.answer.kind === 'single_choice' || q.answer.kind === 'multi_choice') ? q.answer.options : []
  const option = options.find((o) => o.id === issue.optionId)
  const optionName = option ? `"${option.label}"` : 'אפשרות'
  const field = issue.field ? FIELD[issue.field] ?? 'שדה' : 'שדה'
  switch (issue.code) {
    case 'missing_text':
      if (issue.optionId) return `בשאלה ${question} יש אפשרות בלי שם.`
      return `חסר טקסט ב${field}${q ? ` בשאלה ${question}` : ''}.`
    case 'too_long':
      return `${field}${q ? ` בשאלה ${question}` : ''} ארוך מדי.`
    case 'no_questions':
      return 'אין עדיין שאלות בשאלון.'
    case 'too_few_options':
      return `בשאלה ${question} צריך לפחות שתי אפשרויות.`
    case 'too_many_items':
      return `יש יותר מדי פריטים${q ? ` בשאלה ${question}` : ''}.`
    case 'duplicate_option_label':
      return `בשאלה ${question} יש שתי אפשרויות עם אותו שם.`
    case 'phrasing_on_two_options':
      return `בשאלה ${question} אותו ניסוח מזוהה גם כאפשרות אחרת.`
    case 'condition_on_later_or_missing_question':
      return `השאלה ${question} תלויה בשאלה שנמחקה או שמופיעה אחריה.`
    case 'condition_on_non_choice':
      return `השאלה ${question} תלויה בשאלה שאין בה אפשרויות לבחירה.`
    case 'condition_needs_answer':
      return issue.endingIndex !== undefined
        ? 'בסיום השונה צריך לבחור לפחות תשובה אחת שאחריה הוא נשלח.'
        : `בשאלה ${question} צריך לבחור לפחות תשובה אחת שאחריה היא מופיעה.`
    case 'condition_on_deleted_option':
      return `השאלה ${question} תלויה באפשרות שנמחקה.`
    case 'ending_condition_on_deleted_option':
      return 'הודעת סיום מותאמת מתייחסת לאפשרות שנמחקה.'
    case 'ending_condition_on_non_choice':
      return 'הודעת סיום מותאמת מתייחסת לשאלה שאין בה אפשרויות לבחירה.'
    case 'ending_needs_one_condition':
      return 'צריך לבחור מתי לשלוח את הודעת הסיום המותאמת.'
    case 'icon_invalid':
      return `האייקון של ${optionName} יכול להיות סמל בלבד, בלי אותיות או מספרים.`
    case 'message_too_long':
      return `ההודעה של השאלה ${question} ארוכה מדי לוואטסאפ.`
    case 'unreachable_question':
      return `אף לקוח לא יגיע לשאלה ${question}.`
    case 'other_without_follow_up':
      return `כשלקוח בוחר ${optionName}, כדאי לשאול אותו לפרטים.`
    case 'conditions_more_than_one_not_supported_yet':
      return 'כרגע אפשר להגדיר תנאי אחד בלבד.'
    case 'messages_not_supported_for_choice':
      return `בשאלה ${question} עם אפשרויות לבחירה אי אפשר עדיין לשנות את הודעת "לא הבנו".`
    case 'unknown_id':
    case 'duplicate_id':
      return 'השאלון השתנה במקום אחר. טענו את הגרסה העדכנית לפני שממשיכים.'
    default:
      return `יש בעיה${q ? ` בשאלה ${question}` : ' בשאלון'}.`
  }
}
