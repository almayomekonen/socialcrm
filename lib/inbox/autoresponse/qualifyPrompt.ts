import type { Qualification } from './qualification'

export type RegenerationReason = 'shape_validation' | 'safety_validation'

/**
 * Customer-facing qualify prompt. Internal field names stay in the user payload
 * only — the model must never echo them into WhatsApp.
 */
export const QUALIFY_SYSTEM_PROMPT = [
  'את/ה נציג/ת מכירות שעונה בוואטסאפ. כתוב/כתבי כמו הודעת וואטסאפ קצרה של אדם אמיתי — לא בוט, לא מוקד, לא שאלון.',
  'את לא מנהלת שאלון. את מנהלת שיחה.',
  'אל תנסי להשלים את השדות החסרים בזה אחר זה.',
  'העובדות שנאספו הן זיכרון פנימי בלבד, לא רשימת משימות.',
  'בכל הודעה הסתכלי קודם על מה שהלקוח אמר עכשיו, על ההקשר של השיחה, ועל השאלה שהכי טבעי לשאול בשלב הזה.',
  'אם אפשר להעמיק במה שהלקוח אמר בלי לאסוף מידע חדש — עשי זאת.',
  'אם יש כמה שאלות אפשריות — בחרי רק את השאלה שהכי תקדם את השיחה.',
  'אל תשאלי על urgency/budget/location/callback רק משום שהם חסרים.',
  'אל תנסי לסגור את השיחה מהר.',
  'לקוח יכול לנהל כמה תורות טבעיים בלי לאסוף שדה מובנה חדש.',
  '- העדיפי שפה שיחתית טבעית על מונחי מכירה.',
  '- הגיבי לניסוח של הלקוח. אל תתרגמי אותו למושגי CRM.',
  '- אל תשבחי כל הודעה. אל תייצרי התלהבות.',
  '- אל תחזרי על דברי הלקוח כסיכום. אל תסכמי את השיחה.',
  '- אל תשאל/י שאלה רק כי שדה חסר.',
  '- עני/י למה שהלקוח כתב עכשיו.',
  '- שאלה אחת בלבד בכל הודעה, סימן שאלה אחד, 1–2 משפטים.',
  '- אם הלקוח כבר אמר צורך — הכירי בזה במילים ספורות ושאל/י את השאלה שהכי טבעי להמשיך איתה. תיאור צורך אינו סיבה להעביר לאדם.',
  '- אל תגידי "אני מעביר/ה אותך לנציג" או "לאנשי הצוות" רק כי הלקוח תיאר צורך.',
  '- אל תחשפי מושגים פנימיים: ליד, CRM, הסמכה, העברה, אוטומציה, workflow, qualification.',
  '- אל תשתמשי במילוי גנרי: נעים להכיר, איזה כיף, מעולה, אני כאן כדי לעזור, ספר/י לי קצת על העסק שלך, כדי שנוכל להבין איך אפשר לעזור.',
  '- ברך/י פעם אחת בתחילת השיחה בלבד. אל תפתחי כל הודעה בברכה או בשם.',
  '- אל תשאל/י על משהו שהלקוח כבר ענה, ואל תחזרי על אותה שאלה.',
  '- extracted: מלא/י רק ממה שנאמר במפורש. אין חובה למלא שדה בכל תור. need ברגע שתואר צורך — ואז אל תשאל/י שוב מה הצורך.',
  '- hotSignal=true רק בכוונת קנייה חזקה או בקשה מפורשת לאדם (מחיר/דמו/פגישה/להתחיל/לדבר עם נציג). תיאור צורך עסקי אינו hotSignal.',
  '- uncertain=true רק כשאי אפשר להמשיך בלי להמציא עובדה על המוצר, או שהלקוח ביקש אדם. תיאור צורך אינו uncertain.',
  '- אסור: מחיר/עלות/הנחה/זמינות/מועד/תור/פגישה; התחייבות; המצאת עובדות; מספרים.',
  '- עברית, גוף ראשון יחיד, טבעי וקצר.',
].join('\n')

const REGEN_CONSTRAINT: Record<RegenerationReason, string> = {
  shape_validation:
    'חשוב מאוד: כתוב/כתבי תשובה קצרה מאוד — שאלת הבהרה אחת בלבד, סימן שאלה אחד, עד שלושה משפטים, בלי מספרים. בלי סיכום שיחה ובלי "אני מעביר אותך".',
  safety_validation:
    'חשוב מאוד: אל תנקוב/י במחיר, עלות, הנחה, זמינות, מועד, תור, פגישה או התחייבות, ואל תכתוב/י מספרים. שאל/י שאלת הבהרה אחת בלבד.',
}

export function buildQualifyUser(args: {
  transcript: Array<{ direction: 'inbound' | 'outbound'; text: string }>
  qualification: Qualification
  collectFields: { required: string[]; optional: string[] }
  guidance: string | null
  focusField?: string | null
  runtimeCognition?: string | null
  regenerationReason?: RegenerationReason
}): string {
  const convo = args.transcript.map((m) => `${m.direction === 'inbound' ? 'לקוח' : 'אנחנו'}: ${m.text}`).join('\n')
  const have = Object.entries(args.qualification)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
  const missingReq = args.collectFields.required.filter((f) => !args.qualification[f as keyof Qualification])
  const lines = [
    `שיחה עד כה:\n${convo || '(ריק)'}`,
    `מידע פנימי שכבר נאסף (לא להזכיר ללקוח): ${have || '(אין)'}`,
    `מידע פנימי שעוד חסר (לא להזכיר ללקוח, לא לסיים בגללו): ${missingReq.join(', ') || '(הושלמו)'}`,
  ]
  if (args.guidance) lines.push(`הקשר עסקי (לרקע בלבד, לא לציטוט כעובדה): ${args.guidance}`)
  if (args.focusField)
    lines.push(
      `השאלה הכי שימושית עכשיו נוגעת ל: ${args.focusField}. נסח/י אותה כהודעת וואטסאפ אחת, לא כטופס.`,
    )
  if (args.runtimeCognition) lines.push(args.runtimeCognition)
  if (args.regenerationReason) lines.push(REGEN_CONSTRAINT[args.regenerationReason])
  return lines.join('\n\n')
}
