import { z } from 'zod'
import type { LeadIntelligenceInputs } from '@/db/aiSummaries'
import { SourceCategory, detectPollution, pruneAndTranslate } from './leadIntelligence'

/**
 * Versioned prompt fingerprint. Changes invalidate the cache key. Bump when
 * either the system prompt or the schema changes in a way that should NOT be
 * served from cache.
 */
export const FOLLOWUP_PROMPT_VERSION = 1

const ChannelEnum = z.enum(['whatsapp', 'sms', 'email', 'phone'])
const ToneEnum = z.enum(['warm', 'direct', 'apologetic'])

export const LeadFollowupSchema = z.object({
  channel: ChannelEnum.describe('הערוץ המומלץ — בחירה אחת בלבד מתוך הרשימה'),
  tone: ToneEnum.describe('הטון הכללי של ההודעה'),
  message: z
    .string()
    .min(20)
    .max(500)
    .describe('גוף ההודעה בעברית, מוכן להעתקה כמו שהיא. עד 500 תווים. בלי placeholders כמו {{שם}} או [...].'),
  reason: z.string().max(140).describe('שורה אחת — למה ההודעה הזו עכשיו, מבוסס על מצב הליד'),
  sources: z.array(SourceCategory).max(3).describe('1-3 קטגוריות מהרשימה הקבועה'),
  confidence: z.enum(['low', 'medium', 'high']).describe('low אם המידע דליל; medium ברירת מחדל; high רק כשיש בסיס מובהק'),
})

export type LeadFollowup = z.infer<typeof LeadFollowupSchema>

export const LEAD_FOLLOWUP_SYSTEM_PROMPT = `אתה מנסח עבור הנציג הודעת המשך אחת לליד אמיתי.
המטרה: לתת לנציג טקסט מוכן להעתקה, שיתחיל את הצעד הבא במעקב.

עקרונות:
- הודעה אחת. לא רשימה. לא הצעות. לא וריאציות.
- שפה טבעית של נציג מכירות, לא של בוט. מותרת אדיבות, אסור פיוט.
- מותר לפנות בשם הליד אם הוא מופיע בקלט. אסור להמציא שם.
- אסור placeholders. אסור [שם הלקוח], אסור {{שם}}, אסור "וכו׳", אסור "...".
- אסור להזכיר שהטקסט נוצר על ידי AI.
- אסור להבטיח דברים שהנציג לא יודע אם הוא יכול לקיים — מחיר, תאריך, אישור.
- אם המעקב נחלש — הכר בכך בעדינות, בלי "מתנצלים" מוגזמים.
- אם הליד טרי — תיפתח, אל תזכיר היסטוריה שלא קיימת.
- אם יש משימה באיחור — ההודעה היא צעד אופרטיבי במסגרת המשימה הזו, לא תיאום על תיאום.

הסכמה:
- channel: ערוץ אחד מתוך whatsapp / sms / email / phone. בחר לפי מה שיש בקלט (טלפון/מייל) ולפי הטון.
- tone: warm / direct / apologetic. בחר אחד.
- message: 20-500 תווים. הודעה אחת מלאה ושמישה.
- reason: שורה אחת. למה ההודעה הזו, ולמה עכשיו. לא תיאור של ההודעה.
- sources: 1-3 קטגוריות מהרשימה הקבועה (הסכמה כופה).
- confidence: low אם הקלט דליל; medium ברירת מחדל; high רק כשיש בסיס ברור.

טון מועדף לפי המצב:
- מעקב באיחור או "המעקב נחלש" → tone=apologetic, פנייה רכה אבל ברורה.
- ליד פעיל עם משימה → tone=direct, צעד תפעולי קונקרטי.
- ליד חדש → tone=warm, פתיחה קלילה ולא דחוקה.

אסור (חובה):
- אסור להמציא תוכן שלא נתמך בקלט: לא לדבר על "שיחה אחרונה" אם אין תיעוד שלה.
- אסור להחזיר שמות שדות פנימיים: pipelineStagnation, daysSinceLastInteraction, stale, cold, null.
- אסור משפטים שיווקיים מנופחים. בלי "פתרון מותאם אישית", בלי "הזדמנות חד פעמית".
- אסור ז׳רגון ביטוחי (סוכן, פוליסה). השפה: לידים, נציג.

דוגמה לסגנון רצוי (ליד עם מעקב באיחור, יש טלפון):
  channel: whatsapp
  tone: apologetic
  message: "היי, רציתי לחזור אלייך אחרי שעבר זמן מאז ששוחחנו. אם זה עדיין רלוונטי, נשמח לסגור את הצעד הבא השבוע. מתי נוח לך לדבר?"
  reason: "אין תיעוד יצירת קשר 18 ימים והמשימה שנקבעה לא טופלה."
  sources: ["פעילות אחרונה", "היסטוריית המשימות"]
  confidence: medium`

export function buildLeadFollowupUserMessage(inputs: LeadIntelligenceInputs, leadName: string | null): string {
  const shape = pruneAndTranslate(inputs)
  const namedShape: Record<string, unknown> = leadName ? { 'שם הליד': leadName, ...shape } : shape
  return `נתוני הליד (JSON):\n${JSON.stringify(namedShape, null, 2)}\n\nהחזר אובייקט לפי הסכמה.`
}

export type FollowupSanitizationReport = {
  polluted: boolean
  fields: string[]
  sample?: string
}

/**
 * Sanitize the followup output. Unlike the summary's "replace with placeholder"
 * approach, a polluted MESSAGE has no safe textual fallback (we cannot put
 * "אין מספיק מידע" into a message the rep would copy). Strategy:
 *   - If `message` is polluted → return null and the caller treats this as a
 *     soft failure (panel shows error, no message rendered).
 *   - If `reason` is polluted → replace with a generic neutral reason and
 *     drop confidence to 'low'.
 *   - Always dedupe sources.
 */
export function sanitizeLeadFollowup(
  out: LeadFollowup,
): { result: LeadFollowup | null; report: FollowupSanitizationReport } {
  const fields: string[] = []
  let sample: string | undefined

  const messageCheck = detectPollution(out.message)
  if (!messageCheck.clean) {
    fields.push('message')
    sample = messageCheck.hit
    return { result: null, report: { polluted: true, fields, sample } }
  }

  const reasonCheck = detectPollution(out.reason)
  let reason = out.reason
  if (!reasonCheck.clean) {
    fields.push('reason')
    sample = sample ?? reasonCheck.hit
    reason = 'מבוסס על מצב הליד הנוכחי.'
  }

  const dedupedSources = Array.from(new Set(out.sources)) as typeof out.sources
  const polluted = fields.length > 0

  return {
    result: {
      channel: out.channel,
      tone: out.tone,
      message: out.message.trim(),
      reason,
      sources: dedupedSources,
      confidence: polluted ? 'low' : out.confidence,
    },
    report: { polluted, fields, sample },
  }
}
