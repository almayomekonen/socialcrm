import { z } from 'zod'
import type { AnalysisMessage } from '@/db/conversationIntelligence'

/**
 * Composite conversation analysis prompt (Conversation Intelligence, Phase 3).
 *
 * ONE AI call returns summary + intent + lead temperature + suggested action
 * (with confidences) — the marginal cost of the extra fields is near zero
 * compared to separate calls. The action is a RECOMMENDATION only: nothing is
 * executed, no CRM records change, no tasks are created. Agent behavior is
 * explicitly out of scope.
 */

/**
 * Versioned prompt fingerprint, persisted to conversation_intelligence.promptVersion.
 * v1 = summary only. v2 = + intent + temperature. v3 = + suggested action.
 */
export const CONVERSATION_ANALYSIS_PROMPT_VERSION = 3

export const INTENT_VALUES = ['pricing', 'demo', 'signup', 'support', 'followup', 'information', 'other'] as const
export const TEMPERATURE_VALUES = ['cold', 'warm', 'hot'] as const
export const ACTION_VALUES = [
  'send_quote',
  'schedule_demo',
  'follow_up',
  'answer_question',
  'close_lead',
  'escalate_support',
  'none',
] as const

export type ConversationIntent = (typeof INTENT_VALUES)[number]
export type LeadTemperature = (typeof TEMPERATURE_VALUES)[number]
export type SuggestedAction = (typeof ACTION_VALUES)[number]

const Confidence = z.enum(['low', 'medium', 'high'])

export const ConversationAnalysisSchema = z.object({
  summary: z
    .string()
    .min(10)
    .max(400)
    .describe('סיכום השיחה בעברית, 1-3 משפטים, עד 400 תווים. עובדות בלבד מתוך ההודעות.'),
  intent: z.enum(INTENT_VALUES).describe('הכוונה העיקרית של הליד בשיחה — ערך אחד מהרשימה'),
  intentConfidence: Confidence.describe('רמת הביטחון בזיהוי הכוונה'),
  temperature: z.enum(TEMPERATURE_VALUES).describe('חום הליד על בסיס השיחה — ערך אחד מהרשימה'),
  temperatureConfidence: Confidence.describe('רמת הביטחון בקביעת החום'),
  suggestedAction: z.enum(ACTION_VALUES).describe('הצעד הבא המומלץ לנציג — ערך אחד מהרשימה'),
  actionConfidence: Confidence.describe('רמת הביטחון בהמלצה'),
  actionReason: z
    .string()
    .max(140)
    .describe('שורה אחת בעברית — למה זה הצעד הנכון עכשיו, מבוסס על השיחה בלבד'),
})

export type ConversationAnalysis = z.infer<typeof ConversationAnalysisSchema>

export const CONVERSATION_ANALYSIS_SYSTEM_PROMPT = `אתה מנתח שיחה בין ליד (לקוח פוטנציאלי) לבין נציג, עבור מערכת CRM.
המטרה: שהנציג יבין את מצב השיחה תוך 5 שניות — מה קרה, מה הליד רוצה, וכמה הוא חם.

נתח אך ורק את מה שנאמר בפועל בהודעות. אסור להמציא, להשלים או לנחש.

summary — סיכום:
- 1-3 משפטים קצרים בעברית. בלי פתיחים ("בשיחה זו..."), ישר לעניין.
- כלול: מה הליד רוצה, מה סוכם או נשאל, ומה נקודת העצירה הנוכחית.
- אם הליד ממתין לתשובה מהנציג — ציין זאת.
- אם השיחה דלה — סכם בקצרה את מה שיש, בלי לנפח.

intent — הכוונה העיקרית של הליד (ערך אחד):
- pricing: שואל על מחיר, עלות, הצעת מחיר, תנאי תשלום.
- demo: מבקש הדגמה, פגישת התרשמות, לראות את המוצר/השירות.
- signup: רוצה להצטרף, לסגור, לרכוש, להתקדם לחתימה.
- support: בעיה או בקשת שירות בנושא קיים.
- followup: ממשיך או מתאם המשך לשיחה/סיכום קודם.
- information: שואל שאלות מידע כלליות על המוצר/השירות.
- other: שום דבר מהרשימה לא מתאים.
- אם יש כמה כוונות — בחר את המאוחרת/הדומיננטית בשיחה.

temperature — חום הליד (ערך אחד):
- hot: כוונת התקדמות ברורה — מבקש לסגור, דחיפות, שאלות תכל'ס על מחיר/תנאים.
- warm: מתעניין באופן פעיל ועונה לעניין, אבל בלי דחיפות או מחויבות.
- cold: עניין נמוך — תשובות קצרות וקרות, דחייה, חוסר מענה לפניות הנציג.

suggestedAction — הצעד הבא המומלץ לנציג (ערך אחד). זו המלצה בלבד, שום פעולה לא מתבצעת אוטומטית:
- send_quote: הליד ביקש מחיר או בשל לקבל הצעה — שלח הצעת מחיר.
- schedule_demo: הליד רוצה לראות את המוצר/השירות — קבע הדגמה או פגישה.
- follow_up: השיחה נעצרה או שהליד לא הגיב — שלח הודעת המשך.
- answer_question: יש שאלה פתוחה של הליד שטרם נענתה — ענה עליה.
- close_lead: הליד הביע נכונות ברורה להתקדם/לסגור — התקדם לסגירה.
- escalate_support: בעיית שירות שדורשת טיפול — העבר לגורם המטפל.
- none: אין צעד מועיל כרגע (למשל: הליד ביקש להפסיק קשר, או שהנציג כבר ענה ואין מה להוסיף).
- בחר את הצעד בעל הערך הגבוה ביותר לנציג עכשיו. אחד בלבד.

actionReason — שורה אחת (עד 140 תווים) בעברית: למה זה הצעד הנכון עכשיו. נמק מתוך השיחה עצמה, לא תיאור כללי של הפעולה.

confidence (לכוונה, לחום ולהמלצה): low אם ההודעות דלות או דו-משמעיות; medium ברירת מחדל; high רק כשיש בסיס מובהק.

כללים:
- אסור להזכיר שהניתוח נוצר על ידי AI.
- אסור ז'רגון ביטוחי (סוכן, פוליסה). השפה: ליד, נציג.
- אסור להחזיר שמות שדות פנימיים או טקסט באנגלית בסיכום אלא אם הופיע בהודעות עצמן.`

export type ConversationAnalysisContext = {
  channel: string
  leadName: string | null
  leadStatus: string | null
  customerName: string | null
  messages: AnalysisMessage[]
}

const CHANNEL_LABELS: Record<string, string> = { whatsapp: 'וואטסאפ' }

export function buildConversationAnalysisUserMessage(ctx: ConversationAnalysisContext): string {
  const lines: string[] = []

  lines.push(`ערוץ: ${CHANNEL_LABELS[ctx.channel] ?? ctx.channel}`)
  const name = ctx.leadName ?? ctx.customerName
  if (name) lines.push(`שם הליד: ${name}`)
  if (ctx.leadStatus) lines.push(`סטטוס הליד במערכת: ${ctx.leadStatus}`)

  lines.push('', `ההודעות האחרונות בשיחה (מהישנה לחדשה):`)
  for (const m of ctx.messages) {
    const speaker = m.direction === 'inbound' ? 'ליד' : 'נציג'
    const text = m.text.trim() || '[הודעה ללא טקסט — מדיה/קובץ]'
    lines.push(`${speaker}: ${text}`)
  }

  lines.push(
    '',
    'החזר אובייקט לפי הסכמה: summary, intent, intentConfidence, temperature, temperatureConfidence, suggestedAction, actionConfidence, actionReason.',
  )
  return lines.join('\n')
}
