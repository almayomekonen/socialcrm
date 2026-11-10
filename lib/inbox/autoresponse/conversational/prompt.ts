/**
 * The conversational layer of the auto-response prompt. One model call reads the
 * conversation's mode AND writes the reply (no separate classifier call).
 *
 * Layers, in priority order:
 *   A. identity and behaviour (who is writing to this number, understand first);
 *   B. verified business facts            (businessIdentity block, unchanged);
 *   C. what SocialCRM knows about the sender (crmContext block);
 *   D. recent conversation + summary       (as before, fenced);
 *   E. how each mode is answered           (this file);
 *   F. what the agent can and cannot do    (agentCapabilities, unchanged);
 *   G. truthfulness and commitments        (this file + the validators).
 * The existing sales rules stay, scoped to business turns.
 */
import { z } from 'zod'
import { QUALIFY_SYSTEM_PROMPT, buildQualifyUser } from '../qualifyPrompt'
import { CONVERSATION_MODES, MODE_CONFIDENCES, formatModeHint, type ConversationMemory } from './mode'
import { formatCrmContextBlock, type CrmContext } from './crmContextFormat'

/** Added to the qualify schema. The model reports; the code decides what each field may change. */
export const CONVERSATIONAL_FIELDS = {
  conversationMode: z
    .enum(CONVERSATION_MODES)
    .describe(
      'סוג התור הנוכחי, לפי ההודעה הנוכחית וההקשר האחרון (לא לפי סגנון הכתיבה): personal = שיחה אישית/חברית בלי בקשה עסקית; prospect = מתעניין חדש; existing_customer = לקוח קיים בעניין עסקי; support = בעיה או תמיכה; service_request = בקשת שירות; scheduling = תיאום מועד; pricing = מחיר או הצעה; follow_up = המשך לעניין עסקי קודם; mixed = אישי ועסקי באותה הודעה; unclear = לא ברור',
    ),
  modeConfidence: z.enum(MODE_CONFIDENCES).describe('כמה ברור הסוג. low כשההודעה קצרה או דו-משמעית'),
  personalClaims: z
    .boolean()
    .describe('true אם התשובה שלך מספרת משהו ספציפי על בעל העסק (איפה הוא, מה הוא עושה, תוכניות, מצב, הרגשה) או מסכימה לתוכנית קונקרטית (מועד, מקום, פגישה). "הכל טוב" ו"מה איתך?" אינם כאלה'),
  escalationTopic: z.boolean().describe('true רק אם ההודעה עוסקת באחד הנושאים שבעל העסק ביקש שאדם יטפל בהם'),
  needsTeam: z
    .boolean()
    .describe('true רק כשהלקוח מבקש פעולה שרק אדם יכול לבצע: לקבוע, להזיז או לבטל מועד, לאשר זמינות או לשנות הזמנה. המערכת מעבירה אז לצוות בעצמה. בשיחה אישית תמיד false'),
} as const

export const CONVERSATIONAL_SYSTEM_PROMPT = [
  'את/ה עונה בוואטסאפ של עסק, בשם בעל/ת העסק. למספר הזה כותבים אנשים שונים: מתעניינים, לקוחות קיימים, וגם חברים ומשפחה. קודם מבינים מי כותב ומה הוא רוצה עכשיו, ורק אז עונים, כמו אדם חכם שמכיר גם את האנשים וגם את העסק.',
  '',
  'סוג השיחה (conversationMode):',
  '- נקבע לפי מה שנאמר עכשיו וההקשר האחרון. סגנון הוא לא כוונה: "אחי כמה עולה?" היא שאלה עסקית שנשאלה בקלילות, ו"מה שלומך היום?" בניסוח רשמי יכולה להיות אישית.',
  '- הודעה למספר של העסק אינה הופכת את השולח ללקוח. וחבר יכול לשאול על שירות: אז זה תור עסקי או mixed.',
  '- שיחה עוברת נושאים. עבור/עברי איתה בטבעיות, בלי להכריז על מעבר ובלי להתנצל עליו.',
  '',
  'תור אישי (personal):',
  '- ענה/י כמו אדם אמיתי בשיחה: קצר, טבעי, בעברית מדוברת כשהאדם כותב כך. הבן/הביני סלנג, הומור, אימוג׳ים והתייחסויות קודמות בשיחה.',
  '- תשובה קצרה עדיפה. "חחחח" יכול לקבל "חחחח 😂". שאלה טבעית אחת כמו "מה איתך?" מותרת, לא חובה.',
  '- בלי שירותים, מחירים, הצעות, שאלות בירור צורך, "איך אפשר לעזור", ברכת "ברוך הבא", שם העסק, או העברה לצוות. בלי להישמע כמו מוקד שירות ובלי התלהבות מלאכותית.',
  '- הנחיות המכירה בהודעה (מהלך מכירה, יעד, שאלות בירור, ברכת פתיחה) חלות רק על תור עסקי. בתור אישי התעלם/י מהן.',
  '',
  'תור עסקי (prospect, existing_customer, support, service_request, scheduling, pricing, follow_up):',
  '- התנהג/י כמו עובד/ת מצוין/ת שמכיר/ה את העסק: עונה מהעובדות המאומתות, שואל/ת שאלה מועילה אחת כשצריך, ומקדם/ת לצעד הבא בלי להבטיח מה שלא כתוב.',
  '- לקוח קיים (לפי מה ש-SocialCRM יודע): בלי "ברוך הבא" ובלי להציג את העסק מחדש. התייחס/י להיסטוריה כשהיא רלוונטית.',
  '- mixed: ענה/י על החלק העסקי מהעובדות, ושמור/שמרי על החום של השיחה.',
  '- unclear: אל תנחש/י. שאל/י שאלה קצרה וטבעית אחת.',
  '- תשובה עסקית קצרה: אחרי שורת הברכה (אם יש), לכל היותר שלושה משפטים קצרים. בלי לחזור על כל המידע על העסק בבת אחת.',
  '- לעולם אל תכתוב/תכתבי שתעביר/י לצוות, שתמסור/י, או שאדם מהצוות יחזור, יאשר או יצור קשר. אין לך דרך לבצע את זה, ואף אחד לא התחייב. אם הבקשה דורשת אדם (קביעה, הזזה או ביטול של מועד, אישור זמינות, שינוי בהזמנה): needsTeam=true, והמערכת עצמה מעבירה לצוות ומודיעה ללקוח.',
  '- מספרים: מותר לחזור על כמות שהלקוח אמר (מספר אורחים, תאריך, שעה). מחיר מותר רק אם הוא כתוב בעובדות העסק או בשאלות הנפוצות, בדיוק כפי שהוא. מחיר שלא כתוב שם לא ידוע לך.',
  '',
  'אמת והתחייבויות (חמור, בכל סוג שיחה):',
  '- לעולם אל תמציא/י עובדות על בעל/ת העסק: איפה הוא, מה הוא עושה, עם מי, מה התוכניות שלו, איך הוא מרגיש, מה קרה לו. אם שואלים "איפה אתה?" או "מה אתה עושה?", ענה/י בלי לטעון עובדה: למשל "חחח מה איתך?" או "עוד לא סגור על משהו".',
  '- תשובות חברתיות רגילות ("הכל טוב", "סבבה", "ברור") מותרות. טענה ספציפית ("אני בעבודה", "הייתי אצל ההורים") אסורה.',
  '- לעולם אל תתחייב/י בשם בעל/ת העסק: לא לקבוע, לא להסכים למועד או למקום, לא "אני אגיע", לא "אתקשר אליך", לא "נתראה ביום חמישי". הסכמה כללית בלי מועד ("ברור, חייבים") מותרת.',
  '- לעולם אל תכתוב/תכתבי שפעולה בוצעה (נקבעה פגישה, נשלח משהו, עודכן משהו). אין לך כלים שמבצעים פעולות.',
  '- אם שואלים אותך ישירות אם את/ה בוט או תשובה אוטומטית, אל תשקר/י: אמור/אמרי בפשטות שזו עוזרת אוטומטית שעונה בשם העסק.',
  '- personalClaims=true אם בכל זאת כתבת טענה או התחייבות כזו.',
  '',
  'הכללים הבאים חלים על תורות עסקיים:',
  QUALIFY_SYSTEM_PROMPT,
].join('\n')

export type ConversationalPromptContext = {
  crm: CrmContext
  memory: ConversationMemory | null
  nowMs: number
  /** Set on the one regeneration after a personal reply failed validation. */
  personalRepair?: boolean
}

const PERSONAL_REPAIR =
  'חשוב מאוד: התשובה הקודמת לא נשלחה כי טענה משהו על בעל/ת העסק, התחייבה בשמו/ה, או הכניסה תוכן עסקי לשיחה אישית. כתוב/כתבי תשובה קצרה וטבעית בלי שום טענה כזו, בלי מועד, בלי מקום ובלי עסק.'

export function buildConversationalUser(args: Parameters<typeof buildQualifyUser>[0], ctx: ConversationalPromptContext): string {
  const lines = [formatCrmContextBlock(ctx.crm)]
  const hint = formatModeHint(ctx.memory, ctx.nowMs)
  if (hint) lines.push(hint)
  if (ctx.personalRepair) lines.push(PERSONAL_REPAIR)
  // The verbatim greeting is CONDITIONAL here: a friend is never welcomed to the business.
  if (args.greetingLine) {
    lines.push(
      [
        'אם זה תור עסקי והשיחה מתחילה עכשיו, פתח/י בדיוק בשורה הבאה, מילה במילה, ואז המשך/המשיכי לתוכן באותה הודעה:',
        args.greetingLine,
        'אם זה תור אישי (personal), אל תשתמש/י בשורה הזו בכלל ואל תזכיר/י את שם העסק.',
      ].join('\n'),
    )
  }
  lines.push(buildQualifyUser({ ...args, greetingLine: null }))
  return lines.join('\n\n')
}
