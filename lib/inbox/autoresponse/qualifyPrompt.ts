import type { ConversationCognition, Qualification } from './qualification'

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
  'שדות מובנים הם זיכרון CRM, לא רשימת שאלות שמכתיבה את השאלה הבאה.',
  'שם הוא אופציונלי בשיחה. אל תתעדפי אותו על פני צורך מפורש.',
  'אם הלקוח פתח בהודעה שמכילה צורך, כאב או בעיה עסקית ברורה, קודם כל מגיבים לצורך הזה ומעמיקים בו. אין לשאול לשם רק משום שהשם חסר במידע הפנימי.',
  'בכל הודעה הסתכלי קודם על מה שהלקוח אמר עכשיו, על ההקשר של השיחה, ועל השאלה שהכי טבעי לשאול בשלב הזה.',
  'היעד הבא הוא החלטה על מה הכי שווה להבין עכשיו — לא השדה או פרט התהליך שחסר.',
  'אחרי כאב משמעותי שכבר ידוע, להשפעה העסקית בדרך כלל יש ערך גבוה יותר מפרטי תהליך נוספים (כלים, צוות, איך מסמנים).',
  'אם הלקוח כבר מסר כאב, השפעה או תוצאה רצויה — אל תשאל/י על זה שוב. אפשר לדלג קדימה.',
  'אם אפשר להעמיק במה שהלקוח אמר בלי לאסוף מידע חדש — עשי זאת.',
  'אם יש כמה שאלות אפשריות — בחרי רק את היעד שהכי מקדם את השיחה, לא את הפרט הבא ברשימה.',
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

/** Last inbound looks like a stated business need/pain — not a greeting or a name. */
export function inboundStatesBusinessNeed(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return /עזרה|צריכ[הא]|צריך|בעיה|כאב|מפריע|ניהול|לידים|לקוחות|\bneed\b|\bhelp (me|with)\b|\bstruggling\b/i.test(t)
}

/** Operational difficulty — forgetting, losing track, overwhelm. Not the business need itself. */
export function inboundStatesPain(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return /מפריע|שוכח|שוכחת|מפספס|מפספסת|לאיבוד|עמוס|נשכח|לא חוזר|קשה ל|\bforget|\boverwhelm|\blosing track|\bmiss(?:ed)? follow/i.test(t)
}

/** Business consequence of the pain — lost customers, churn, going elsewhere. */
export function inboundStatesImpact(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return /למישה[וויה]|לקוח[הא]? אחר|מפסיד|מפספסת לקוח|הפסד|עוזב|אבד לקוח|עולה לי|בכסף|הכנסות|lost (?:a )?customer|goes? elsewhere|lose (?:them|business|clients|money)|costs? me/i.test(t)
}

/** How they handle it today — spreadsheet, WhatsApp, in their head. */
export function inboundStatesWorkflow(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return /באקסל|בוואטסאפ|בראש|היום אני|\bspreadsheet|\bexcel\b|\bwhatsapp\b|in my head|currently (?:use|manage)/i.test(t)
}

/** Stated desired change — not just the current problem. */
export function inboundStatesOutcome(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  return /רוצה ש|שיהיה אחרת|הייתי רוצה|שזה יעבוד|want (?:it )?to|would (?:like|want)|instead/i.test(t)
}

function formatCognitionMemory(cognition: ConversationCognition | undefined): string {
  const c = cognition ?? {}
  const fact = (v: string | undefined) => (v && v.trim() ? v.trim() : '(לא ידוע)')
  return [
    'כבר מובן (זיכרון פנימי, לא רשימת שדות להשלים):',
    `pain=${fact(c.pain)}`,
    `impact=${fact(c.impact)}`,
    `workflow=${fact(c.currentWorkflow)}`,
    `outcome=${fact(c.desiredOutcome)}`,
    `יעד קודם: ${c.lastObjective ?? '(אין)'}`,
    'בחרי יעד אחד עם הערך הכי גבוה עכשיו. אחרי כאב ידוע, impact לפני עוד תהליך — אלא אם ההשפעה כבר נאמרה.',
  ].join('\n')
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
  // collectFields / focusField / runtimeCognition stay on the signature for
  // call-site compatibility. They must not appear as "ask this CRM field next".
  void args.collectFields
  void args.focusField
  void args.runtimeCognition
  const convo = args.transcript.map((m) => `${m.direction === 'inbound' ? 'לקוח' : 'אנחנו'}: ${m.text}`).join('\n')
  const have = Object.entries(args.qualification)
    .filter(([k, v]) => k !== 'cognition' && typeof v === 'string' && v)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
  const lastInbound = [...args.transcript].reverse().find((m) => m.direction === 'inbound')?.text ?? ''
  const needKnown = Boolean(args.qualification.need) || inboundStatesBusinessNeed(lastInbound)
  const lines = [
    `שיחה עד כה:\n${convo || '(ריק)'}`,
    `מידע פנימי שכבר נאסף (לא להזכיר ללקוח, לא לקבוע לפי זה את השאלה הבאה): ${have || '(אין)'}`,
    formatCognitionMemory(args.qualification.cognition),
  ]
  if (needKnown) {
    lines.push(
      'הלקוח תיאר צורך, כאב או בעיה עסקית. קודם כל הגיבי לזה והעמיקי בזה. אל תשאל/י לשם ואל תשאל/י "מה הצורך שלך" אם הצורך כבר נאמר.',
    )
  }
  if (args.guidance) lines.push(`הקשר עסקי (לרקע בלבד, לא לציטוט כעובדה): ${args.guidance}`)
  if (args.regenerationReason) lines.push(REGEN_CONSTRAINT[args.regenerationReason])
  return lines.join('\n\n')
}
