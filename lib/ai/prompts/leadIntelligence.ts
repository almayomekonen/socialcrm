import { z } from 'zod'
import type { LeadIntelligenceInputs } from '@/db/aiSummaries'
import { leadSourceLabel } from '@/lib/leads/leadSourceLabel'

export const PROMPT_VERSION = 4

export const SourceCategory = z.enum([
  'סטטוס הליד',
  'פעילות אחרונה',
  'היסטוריית המשימות',
  'פרטי הליד',
  'מקור הליד',
  'הטיפול בליד',
])

export const LeadSummarySchema = z.object({
  summary: z.string().max(180).describe('משפט אחד או שניים. סיפור, לא רשימה.'),
  keyInsights: z.array(z.string().max(120)).max(2).describe('עד שתי תובנות חזקות. רשימה ריקה מותרת אם אין תובנה אמיתית.'),
  suggestedNextAction: z
    .object({
      title: z.string().max(80).describe('פעולה אחת קונקרטית הניתנת לביצוע ב-30 שניות'),
      reason: z.string().max(140).describe('שורה אחת של נימוק תפעולי קצר'),
    })
    .describe('פעולה אחת מומלצת'),
  sources: z.array(SourceCategory).max(3).describe('1-3 קטגוריות מהרשימה הקבועה — אסור להשתמש בערך אחר'),
  confidence: z.enum(['low', 'medium', 'high']).describe('low אם המידע דליל; medium ברירת מחדל; high רק כשיש דפוס מובהק'),
})

export type LeadSummary = z.infer<typeof LeadSummarySchema>

export const LEAD_INTEL_SYSTEM_PROMPT = `אתה מנהל מכירות ותיק שסוקר ליד אחד במהירות עבור הנציג.
המטרה: לתת תוך כמה שניות תמונת מצב חדה — מה קורה עכשיו, מה לא קרה למרות שהיה צריך, ומה הצעד הבא.

טון נכון:
- שפה אופרטיבית של מנהל מכירות, לא של עוזר. מסקנות, לא תיאורים.
- "לא הייתה התקדמות שבועיים" עדיף על "הליד פעיל אך שקט".
- ענייני, לא פיוטי. בלי "האנרגיה של השיחה", "רוח הליד", "הליד מאותת", "הליד נושם".
- בלי "אני מציע" / "אני חושב" / "אני ממליץ" — אתה לא מדבר בגוף ראשון.
- כשאין מספיק מידע — אמור זאת בקצרה והורד confidence ל-low.

ביטויים מועדפים (תאר מה קורה, לא תווית מקצועית):
- במקום "סיכון נטישה" → "המעקב נחלש" / "הקשר נעצר" / "לא הייתה התקדמות".
- במקום "פייפליין" → "תהליך" / "התקדמות" / "טיפול" / "מעקב".
- במקום "סטגנציה" → "הסטטוס לא זז" / "אין תזוזה".
- במקום "מעורבות" → "קצב מעקב" / "תדירות הקשר".
- אל תחזור על שמות הקטגוריות מהקלט כתווית סיכום סופי. תאר מה קרה.

אסור (חובה):
- אסור להשתמש בשמות שדות פנימיים, מזהי מטריקות או ערכי enum באנגלית.
  אסור: "pipelineStagnation", "daysSinceLastInteraction", "stale", "cold", "null".
  מותר: "אין תיעוד פעילות מעל לשבוע", "הסטטוס לא זז".
- אסור להמציא או לנחש רגשות, כוונות או מצב נפשי של הליד.
- אסור לחזור על שדות גלויים בכרטיס כעובדה (טלפון, מייל, מקור) — רק כאשר שילובם מחולל תובנה.
- אסור לחבר תובנות-מילוי כשהמידע דליל. עדיף תובנה אחת חזקה מ-2 חלשות. רשימה ריקה מותרת.
- אסור משפטים מנופחים: "המידע מצביע על", "ניתן להסיק כי", "ניתוח הליד מראה".
- אסור ז'רגון ארגוני ל-CRM קטן: "פייפליין", "סטגנציה", "מעורבות". השתמש בשפה אופרטיבית טבעית.
- אסור להחזיר תווית-קטגוריה כתוצאה ("סיכון נטישה: בינוני") — תאר את המצב במילים.
- אסור ז'רגון ביטוחי ("סוכן", "פוליסה"). השפה: לידים, נציג.
- אסור לציין מה שאינו מופיע בקלט. אם אין שדה — אל תזכיר אותו, גם לא כדי לומר שהוא חסר.

הסכמה:
- summary: 1-2 משפטים. סיפור, לא רשימה.
- keyInsights: עד 2. רק אם הן באמת חזקות. אפשר רשימה ריקה.
- suggestedNextAction: פעולה אחת ברורה לביצוע ב-30 שניות + נימוק קצר. תמיד נדרש.
- sources: 1-3 פריטים מתוך 6 קטגוריות קבועות (הסכמה כופה את זה).
- confidence: low אם המידע דליל; medium ברירת מחדל; high רק כשיש דפוס מובהק.

דוגמה לסגנון רצוי:
  summary: "ליד מאינסטגרם, שבועיים בסטטוס פתוח ללא משימה פתוחה. הקשר עוד לא הותנע."
  keyInsights: ["אין משימה פתוחה למעקב למרות שהליד עדיין חדש."]
  nextAction: { title: "פתיחת שיחת מעקב ראשונה",
                reason: "אין תיעוד קשר אחרי הפנייה הראשונית." }
  sources: ["סטטוס הליד", "היסטוריית המשימות"]
  confidence: medium

דוגמה נוספת (ליד שהמעקב עליו דעך):
  summary: "המעקב נחלש בשבועיים האחרונים. אחרי שיחת פתיחה לא נקבעה משימת המשך."
  keyInsights: ["שלוש משימות נסגרו, אך אין משימה חדשה שמחזיקה את התהליך פתוח."]
  nextAction: { title: "תיאום שיחה לחידוש קשר",
                reason: "מהשיחה האחרונה עברו שבועיים בלי המשך מתועד." }
  sources: ["פעילות אחרונה", "היסטוריית המשימות"]
  confidence: medium

דוגמה לסגנון אסור (מה לא לעשות):
  summary: "הליד מאותת לעניין, daysSinceLastInteraction=null, pipelineStagnation=stale.
            רוח השיחה נחלשה."
  keyInsights: ["יש מספר טלפון.", "hasHandler=true."]
  nextAction: { title: "צור קשר",
                reason: "להמשיך את התקדמות הליד בפייפליין. סיכון נטישה: בינוני." }`

const STAGNATION_HE: Record<string, string> = {
  fresh: 'טרי',
  active: 'פעיל',
  slow: 'איטי',
  stale: 'דועך',
  cold: 'קר',
}

const RISK_HE: Record<string, string> = {
  low: 'נמוך',
  medium: 'בינוני',
  high: 'גבוה',
}

export function pruneAndTranslate(p: LeadIntelligenceInputs): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  // Always-present anchors.
  if (p.status) out['סטטוס'] = p.status
  // Semantic label only: feed the AI the clean channel ("WhatsApp") rather than
  // the raw composite ("whatsapp:{wamid}"). Same guard, no control-flow change.
  if (p.leadSource) out['מקור הליד'] = leadSourceLabel(p.leadSource)
  if (typeof p.leadAgeDays === 'number') out['ימים מהיצירה'] = p.leadAgeDays
  if (typeof p.daysInCurrentStatus === 'number') out['ימים בסטטוס נוכחי'] = p.daysInCurrentStatus

  if (p.pipelineStagnation) out['מצב הטיפול'] = STAGNATION_HE[p.pipelineStagnation] ?? p.pipelineStagnation
  if (p.inactivityRisk) out['דחיפות במעקב'] = RISK_HE[p.inactivityRisk] ?? p.inactivityRisk

  if (typeof p.daysSinceLastInteraction === 'number') {
    out['ימים מאינטראקציה אחרונה'] = p.daysSinceLastInteraction
  }
  if (p.lastOutcomeType && p.lastOutcomeType.trim().length > 0) {
    out['תוצאת אינטראקציה אחרונה'] = p.lastOutcomeType
  }
  if (typeof p.daysSinceLastTask === 'number') {
    out['ימים מהמשימה האחרונה'] = p.daysSinceLastTask
  }
  if (typeof p.daysSinceLastCompletedTask === 'number') {
    out['ימים מהמשימה האחרונה שהושלמה'] = p.daysSinceLastCompletedTask
  }
  if (typeof p.taskCompletionRate === 'number') {
    out['אחוז משימות שהושלמו'] = p.taskCompletionRate
  }
  if (p.overdueTaskCount > 0) {
    out['משימות באיחור'] = p.overdueTaskCount
  }

  // Recent task list — keep only when non-empty.
  if (Array.isArray(p.recentTasks) && p.recentTasks.length > 0) {
    out['משימות אחרונות'] = p.recentTasks.map((t) => ({
      כותרת: t.title,
      סטטוס: t.status ?? null,
      ימים: t.daysOld ?? null,
    }))
  }

  // Free-text — keep only when non-empty.
  if (p.detailsExcerpt && p.detailsExcerpt.trim().length > 0) {
    out['הערות מילוליות'] = p.detailsExcerpt
  }

  // Ownership — drop when no handler.
  if (p.hasHandler && p.handlerName) {
    out['מטפל בליד'] = p.handlerName
  }

  // Demographics — drop when null. Don't mention absence.
  if (p.gender) out['מין'] = p.gender
  if (p.familyStatus) out['מצב משפחתי'] = p.familyStatus
  if (typeof p.ageYears === 'number') out['גיל'] = p.ageYears
  if (p.familyMemberCount > 0) out['מספר בני משפחה'] = p.familyMemberCount

  // Boolean noise — only mention contact channels when present, and only as
  // soft anchors. Don't surface "false" values at all.
  if (p.hasEmail) out['ערוץ קשר: מייל'] = true
  if (p.hasPhone) out['ערוץ קשר: טלפון'] = true

  if (typeof p.rank === 'number') out['דירוג'] = p.rank

  return out
}

export function buildLeadIntelUserMessage(inputs: LeadIntelligenceInputs): string {
  const shape = pruneAndTranslate(inputs)
  return `נתוני הליד (JSON):\n${JSON.stringify(shape, null, 2)}\n\nהחזר אובייקט לפי הסכמה.`
}

const BANNED_TOKENS: readonly string[] = [
  // Field names from LeadIntelligenceInputs
  'leadAgeDays',
  'daysSinceLastInteraction',
  'daysInCurrentStatus',
  'daysSinceLastTask',
  'daysSinceLastCompletedTask',
  'taskCompletionRate',
  'overdueTaskCount',
  'pipelineStagnation',
  'inactivityRisk',
  'lastOutcomeType',
  'hasHandler',
  'handlerName',
  'hasEmail',
  'hasPhone',
  'familyMemberCount',
  'detailsExcerpt',
  'recentTasks',
  'updatedAtIso',
  'leadSource',
  'familyStatus',
  'ageYears',
  'fileId',
  'mediaType',
  'originalChars',
  'truncated',
  // Enum values
  'pipelineStagnation=',
  'inactivityRisk=',
  // Boolean / null leakage
  'null',
  'undefined',
  '=true',
  '=false',
  'stale',
  'cold',
  'fresh',
]

const POLLUTION_PLACEHOLDER = 'אין מספיק מידע מובהק להסקה.'

export function detectPollution(text: string): { clean: boolean; hit?: string } {
  if (!text) return { clean: true }
  const lower = text.toLowerCase()
  const hit = BANNED_TOKENS.find((token) => lower.includes(token.toLowerCase()))
  return hit ? { clean: false, hit } : { clean: true }
}

export type SanitizationReport = {
  polluted: boolean
  fields: string[]
  sample?: string
}

/**
 * Tiny accumulator for the placeholder-substitution sanitizer pattern shared
 * by Summary / NextStep / AskAnswer.
 *
 *   - `clean(text, fieldName)` returns the original text if clean, or the
 *     configured placeholder if polluted (recording the field + sample).
 *   - `finalize()` returns the matching `SanitizationReport`.
 *
 * Followup's `message` field uses a different policy (reject the result
 * entirely on pollution) and stays inline — forcing it into this helper would
 * trade clarity for false reuse.
 */
export function makeFieldCleaner(placeholder: string) {
  const fields: string[] = []
  let sample: string | undefined
  return {
    clean(text: string, fieldName: string): string {
      const check = detectPollution(text)
      if (check.clean) return text
      fields.push(fieldName)
      if (!sample) sample = check.hit
      return placeholder
    },
    finalize(): SanitizationReport {
      return { polluted: fields.length > 0, fields, sample }
    },
  }
}

export function sanitizeLeadSummary(s: LeadSummary): { result: LeadSummary; report: SanitizationReport } {
  const cleaner = makeFieldCleaner(POLLUTION_PLACEHOLDER)

  const summary = cleaner.clean(s.summary, 'summary')
  const cleanedInsights = s.keyInsights
    .map((insight, i) => cleaner.clean(insight, `keyInsights[${i}]`))
    .filter((x) => x !== POLLUTION_PLACEHOLDER)
  const title = cleaner.clean(s.suggestedNextAction.title, 'suggestedNextAction.title')
  const reason = cleaner.clean(s.suggestedNextAction.reason, 'suggestedNextAction.reason')

  const report = cleaner.finalize()
  const dedupedSources = Array.from(new Set(s.sources)) as typeof s.sources

  return {
    result: {
      summary,
      keyInsights: cleanedInsights,
      suggestedNextAction: { title, reason },
      sources: dedupedSources,
      confidence: report.polluted ? 'low' : s.confidence,
    },
    report,
  }
}
