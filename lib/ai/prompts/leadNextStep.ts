import { z } from 'zod'
import type { LeadIntelligenceInputs } from '@/db/aiSummaries'
import { SourceCategory, makeFieldCleaner, pruneAndTranslate } from './leadIntelligence'

export const NEXT_STEP_PROMPT_VERSION = 1

const UrgencyEnum = z.enum(['now', 'this-week', 'when-possible'])

export const LeadNextStepSchema = z.object({
  recommendation: z.string().min(8).max(120).describe('משפט אחד — הפעולה המוצעת. קונקרטית, ניתנת לביצוע ב-30 שניות.'),
  rationale: z.string().min(10).max(220).describe('1-2 משפטים — למה זה הצעד הנכון עכשיו, מבוסס על מצב הליד.'),
  urgency: UrgencyEnum.describe('now אם זה דחוף; this-week אם רצוי השבוע; when-possible אם זה כיוון כללי.'),
  sources: z.array(SourceCategory).max(3).describe('1-3 קטגוריות מהרשימה הקבועה'),
  confidence: z.enum(['low', 'medium', 'high']).describe('low אם המידע דליל; medium ברירת מחדל; high רק כשיש דפוס מובהק'),
})

export type LeadNextStep = z.infer<typeof LeadNextStepSchema>

export const LEAD_NEXT_STEP_SYSTEM_PROMPT = `אתה מנהל מכירות ותיק שאומר לנציג מה הצעד הבא הכי נכון בליד אחד.
המטרה: צעד אחד קונקרטי שאפשר לבצע עכשיו, עם נימוק קצר.

עקרונות:
- צעד אחד. לא רשימה. לא וריאציות.
- שפה אופרטיבית של מנהל מכירות. בלי תיאוריה, בלי "כדאי שתשקול".
- אם המידע דליל — תגיד צעד פשוט (למשל "שיחה ראשונית") ותוריד confidence ל-low.
- אם הליד בסטטוס סופי (סגורה / לא רלוונטי / לא מעוניין / הסתיים טיפול) — אין צעד אופרטיבי. תגיד "אין צעד פעיל בליד שנסגר" ב-recommendation, ב-rationale הסבר קצר, urgency=when-possible, confidence=high.

הסכמה:
- recommendation: משפט אחד עד 120 תווים. פעולה קונקרטית.
  טוב: "תיאום שיחה לחידוש קשר השבוע." / "סגירת המשימה הפתוחה ועדכון הסטטוס."
  רע: "כדאי לחשוב על הצעדים הבאים." / "לבחון את האפשרויות."
- rationale: 1-2 משפטים. למה הצעד הזה ולמה עכשיו. מבוסס על מצב הליד.
- urgency: now / this-week / when-possible. בחר אחד.
- sources: 1-3 קטגוריות מהרשימה הקבועה (הסכמה כופה).
- confidence: low / medium / high.

מיפוי urgency:
- משימה באיחור או "אין יצירת קשר" 21+ ימים → urgency=now.
- ליד פעיל ללא משימה פתוחה, או "המעקב נחלש" → urgency=this-week.
- ליד יציב, התקדמות תקינה → urgency=when-possible.

אסור (חובה):
- אסור להמציא נתונים לא קיימים.
- אסור להחזיר שמות שדות פנימיים: pipelineStagnation, daysSinceLastInteraction, stale, cold, null.
- אסור להציע שתי פעולות בנשימה אחת ("לתאם שיחה ולשלוח מייל"). פעולה אחת.
- אסור משפטי-מילוי: "המידע מצביע", "ניתן להסיק". תגיד את המסקנה ישירות.
- אסור ז׳רגון ביטוחי (סוכן, פוליסה). השפה: לידים, נציג.

דוגמה (ליד עם מעקב באיחור):
  recommendation: "התקשר היום לחידוש קשר ולהעלאה של המשימה שלא טופלה."
  rationale: "אין יצירת קשר 18 ימים והמשימה שנקבעה לא טופלה — בלי מגע פעיל הליד יידעך."
  urgency: "now"
  sources: ["פעילות אחרונה", "היסטוריית המשימות"]
  confidence: medium

דוגמה (ליד טרי):
  recommendation: "פתיחת שיחה ראשונית להבנת הצורך."
  rationale: "ליד חדש ללא תיעוד קשר. הצעד הבא הוא מגע ראשון ולא תכנון מתקדם."
  urgency: "this-week"
  sources: ["סטטוס הליד"]
  confidence: medium`

export function buildLeadNextStepUserMessage(inputs: LeadIntelligenceInputs, leadName: string | null): string {
  const shape = pruneAndTranslate(inputs)
  const named: Record<string, unknown> = leadName ? { 'שם הליד': leadName, ...shape } : shape
  return `נתוני הליד (JSON):\n${JSON.stringify(named, null, 2)}\n\nהחזר אובייקט לפי הסכמה.`
}

export type NextStepSanitizationReport = {
  polluted: boolean
  fields: string[]
  sample?: string
}

const POLLUTION_PLACEHOLDER = 'אין מספיק מידע מובהק להסקה.'

export function sanitizeLeadNextStep(out: LeadNextStep): { result: LeadNextStep; report: NextStepSanitizationReport } {
  const cleaner = makeFieldCleaner(POLLUTION_PLACEHOLDER)

  const recommendation = cleaner.clean(out.recommendation, 'recommendation')
  const rationale = cleaner.clean(out.rationale, 'rationale')

  const report = cleaner.finalize()
  const dedupedSources = Array.from(new Set(out.sources)) as typeof out.sources

  return {
    result: {
      recommendation,
      rationale,
      urgency: out.urgency,
      sources: dedupedSources,
      confidence: report.polluted ? 'low' : out.confidence,
    },
    report,
  }
}
