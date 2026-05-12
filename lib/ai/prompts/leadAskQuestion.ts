import { z } from 'zod'
import type { LeadIntelligenceInputs } from '@/db/aiSummaries'
import { makeFieldCleaner, pruneAndTranslate } from './leadIntelligence'

export const ASK_QUESTION_PROMPT_VERSION = 2

export const LENS_IDS = ['conversations', 'tasks', 'notes', 'files'] as const
export type LensId = (typeof LENS_IDS)[number]

const AskSourceCategory = z.enum([
  'סטטוס הליד',
  'פעילות אחרונה',
  'היסטוריית המשימות',
  'פרטי הליד',
  'מקור הליד',
  'הטיפול בליד',
  'קבצים שצורפו',
])

const LENS_LABEL_HE: Record<LensId, string> = {
  conversations: 'שיחות אחרונות וקצב מעקב',
  tasks: 'משימות ומעקבים',
  notes: 'הערות מילוליות',
  files: 'קבצים שצורפו',
}

export const LeadAskAnswerSchema = z.object({
  answer: z.string().min(6).max(800).describe('תשובה תפעולית קצרה, 1-3 פסקאות. ללא רשימות אלא אם השאלה מבקשת ניסוח/טיוטה.'),
  confidence: z.enum(['low', 'medium', 'high']).describe('low אם המידע דליל; medium ברירת מחדל; high רק כשיש דפוס מובהק.'),
  sources: z.array(AskSourceCategory).max(3).describe('1-3 קטגוריות מהרשימה הקבועה. ריק אם התשובה היא הצהרה כללית.'),
})

export type LeadAskAnswer = z.infer<typeof LeadAskAnswerSchema>

export const LEAD_ASK_QUESTION_SYSTEM_PROMPT = `אתה עוזר חכם של נציג מכירות בתוך CRM של לידים מסושיאל. אתה עונה על שאלה אחת קונקרטית של הנציג לגבי ליד מסוים, מבוסס על נתוני הליד.

עקרונות:
- השפה: עברית, שפת מנהל מכירות. "מה כדאי לשלוח?", "מה השתנה?", "מה הצעד הבא?".
- ענייני, לא פיוטי. בלי "אנרגיה", "תחושת הליד", "הליד מאותת". מסקנה ישירה.
- תשובה אחת מלוכדת. בלי הקדמות מנומסות ("בהחלט!", "שאלה מצוינת"). בלי גוף ראשון ("אני חושב").
- אם השאלה היא בקשה לניסוח (הודעה, מייל, וואטסאפ) — תן את הטקסט עצמו, מוכן לשליחה. בלי הסברים מסביב.
- אם השאלה היא תכנונית (מה הצעד הבא, מה כדאי לעשות) — תן פעולה אחת קונקרטית + נימוק קצר.
- אם השאלה היא מצבית (מה השתנה, איפה אנחנו עומדים) — תאר את התמונה בקצרה. בלי לחזור על שדות גלויים בכרטיס.
- אם המידע לא מספיק — אמור זאת בקצרה והורד confidence ל-low. עדיף תשובה כנה קצרה מספקולציה ארוכה.
- אם הליד בסטטוס סופי (סגורה / לא רלוונטי / לא מעוניין) — אמור זאת והסבר בקצרה. בלי להציע פעולות מכירה.

מיקוד (lenses):
הנציג עשוי לציין במה למקד את התשובה. אם צוינו lenses — תעדף את הקטגוריות הללו בתשובה. אם לא צוינו — בחר את הרלוונטי ביותר לשאלה.

קבצים מצורפים:
ייתכן שהשאלה כוללת קבצים שהנציג צירף עכשיו.
- קובץ PDF/Excel יופיע כתוכן טקסטואלי שנקרא בדפדפן ("תוכן שנקרא").
- תמונה תישלח אליך כחלק חזותי, יחד עם שם הקובץ.
- **כשמצורף קובץ עם תוכן קריא, ההקשר העיקרי לתשובה הוא תוכן הקובץ — לא נתוני ה-CRM.** השתמש בנתוני הליד רק אם הם משלימים את התשובה. אל תחזור על מטא-דאטה של הליד (סטטוס, גיל, מטפל) כשהשאלה היא על תוכן הקובץ.
- אם השאלה היא "סכם", "ספר לי על", "מה כתוב כאן", "תרגם", "בדוק" — התייחס למסמך עצמו.
- אם תוכן קובץ קוצר, ענה לפי החלק שקיבלת. ציין שהתוכן חלקי רק אם זה משנה את אמינות התשובה.
- אם השאלה עוסקת בקובץ ואין תוכן קריא או תמונה זמינה — אמור בקצרה שאין מספיק תוכן קריא מהקובץ. אל תיפול חזרה לסיכום הליד.
- אם התשובה נשענת על הקובץ, כלול ב-sources את "קבצים שצורפו".

הסכמה:
- answer: 6-800 תווים. תשובה אחת. פסקה אחת בדרך כלל. עד 3 פסקאות אם נדרש.
  טוב: "התקשר היום. עברו 18 ימים מאינטראקציה אחרונה ואין משימה פתוחה — בלי מגע פעיל הליד יידעך."
  רע: "ניתוח הליד מצביע על מספר נקודות מעניינות. ראשית, נוכל לראות... שנית..."
- confidence: low / medium / high.
- sources: 1-3 קטגוריות מתוך הרשימה הקבועה. ריק רק אם התשובה כללית/מטא.

אסור (חובה):
- אסור להמציא נתונים שלא בקלט.
- אסור להחזיר שמות שדות פנימיים: pipelineStagnation, daysSinceLastInteraction, stale, cold, null.
- אסור משפטי-מילוי: "המידע מצביע", "ניתן להסיק", "ניתוח הליד מראה".
- אסור ז'רגון ביטוחי (סוכן, פוליסה). השפה: לידים, נציג.
- אסור לציין שדות חסרים. אם אין מידע — תגיד זאת קצרה במשפט אחד.
- אסור לחשוף פרטי תשתית של קובץ: S3, כתובת URL, מזהה קובץ, סוג טכני, או שהקובץ הועלה למערכת.

דוגמה (השאלה: "מה כדאי לשלוח לו?"):
  answer: "שלח: 'היי דני, רציתי לחזור אליך אחרי השיחה משבוע שעבר. האם נוח לתאם 10 דקות הבוע לסגור את ההצעה?' — קצר, ממוקד, וקורא להחלטה."
  confidence: medium
  sources: ["פעילות אחרונה", "סטטוס הליד"]

דוגמה (השאלה: "מה הצעד הבא?"):
  answer: "תיאום שיחה לחידוש קשר השבוע. עברו שבועיים מהמשימה האחרונה ואין תיעוד התקדמות — צריך מגע אקטיבי."
  confidence: medium
  sources: ["היסטוריית המשימות", "פעילות אחרונה"]

דוגמה (מידע דליל):
  answer: "אין מספיק תיעוד כדי לענות על זה. הליד נפתח לפני שלושה ימים בלי משימה או הערה."
  confidence: low
  sources: ["סטטוס הליד"]`

export function buildLeadAskQuestionUserMessage(args: {
  inputs: LeadIntelligenceInputs
  leadName: string | null
  question: string
  lenses: LensId[]
  attachments?: LeadQuestionAttachmentContext[]
}): string {
  const shape = pruneAndTranslate(args.inputs)
  const named: Record<string, unknown> = args.leadName ? { 'שם הליד': args.leadName, ...shape } : shape

  const lensLines = args.lenses.length > 0 ? `\nמיקוד מבוקש: ${args.lenses.map((id) => LENS_LABEL_HE[id]).join(' · ')}` : ''
  const attachments = args.attachments ?? []
  const attachmentBlock = buildAttachmentsBlock(attachments)
  const hasReadableAttachment = attachments.some((a) => (a.kind === 'text' && a.content.trim().length > 0) || a.kind === 'image')

  if (hasReadableAttachment) {
    // Lead with the file. Lead JSON moves below as supporting context only.
    return `${attachmentBlock.trimStart()}\n\nנתוני הליד (JSON, הקשר משלים בלבד):\n${JSON.stringify(named, null, 2)}${lensLines}\n\nהשאלה של הנציג:\n${args.question}\n\nהנחיה: כש'תוכן שנקרא' של קובץ קיים, ענה מתוכו. אל תתאר את הליד אלא אם הנציג שאל על נתוני הליד במפורש.\n\nהחזר אובייקט לפי הסכמה.`
  }

  return `נתוני הליד (JSON):\n${JSON.stringify(named, null, 2)}${lensLines}${attachmentBlock}\n\nהשאלה של הנציג:\n${args.question}\n\nהחזר אובייקט לפי הסכמה.`
}

export type LeadQuestionAttachmentContext =
  | {
      kind: 'text'
      name: string
      mediaType: string
      size: number
      content: string
      partial: boolean
      originalChars: number
    }
  | {
      kind: 'image'
      name: string
      mediaType: string
      size: number
    }
  | {
      kind: 'unreadable'
      name: string
      mediaType: string
      size: number
      reason: 'unsupported-type' | 'extraction-failed' | 'empty-text' | 'total-limit'
    }

const UNREADABLE_REASON_HE: Record<Extract<LeadQuestionAttachmentContext, { kind: 'unreadable' }>['reason'], string> = {
  'unsupported-type': 'סוג הקובץ לא נתמך לקריאה',
  'extraction-failed': 'לא ניתן היה לחלץ תוכן מהקובץ',
  'empty-text': 'לא נמצא תוכן טקסטואלי קריא',
  'total-limit': 'לא נכלל בגלל מגבלת תוכן לשאלה אחת',
}

function buildAttachmentsBlock(attachments: LeadQuestionAttachmentContext[]): string {
  if (attachments.length === 0) return ''

  const shape = attachments.map((attachment) => {
    const base = {
      'שם הקובץ': attachment.name,
      סוג: friendlyMediaType(attachment.mediaType),
      'גודל בבתים': attachment.size,
    }

    if (attachment.kind === 'text') {
      return {
        ...base,
        'מצב קריאה': attachment.partial ? 'חלקי' : 'מלא',
        'תווים במקור': attachment.originalChars,
        'תוכן שנקרא': attachment.content,
      }
    }

    if (attachment.kind === 'image') {
      return {
        ...base,
        'מצב קריאה': 'תמונה נשלחה לקריאה חזותית',
      }
    }

    return {
      ...base,
      'מצב קריאה': UNREADABLE_REASON_HE[attachment.reason],
    }
  })

  return `\n\nקבצים מצורפים לשאלה (JSON):\n${JSON.stringify(shape, null, 2)}`
}

function friendlyMediaType(mediaType: string): string {
  const t = mediaType.toLowerCase()
  if (t === 'application/pdf') return 'PDF'
  if (t.includes('spreadsheet') || t.includes('excel')) return 'Excel'
  if (t.startsWith('image/')) return 'תמונה'
  return 'קובץ'
}

export type AskQuestionSanitizationReport = {
  polluted: boolean
  fields: string[]
  sample?: string
}

const POLLUTION_PLACEHOLDER = 'אין מספיק מידע מובהק כדי לענות על השאלה.'

export function sanitizeLeadAskAnswer(out: LeadAskAnswer): {
  result: LeadAskAnswer
  report: AskQuestionSanitizationReport
} {
  const cleaner = makeFieldCleaner(POLLUTION_PLACEHOLDER)
  const answer = cleaner.clean(out.answer, 'answer')

  const report = cleaner.finalize()
  const dedupedSources = Array.from(new Set(out.sources)) as typeof out.sources

  return {
    result: {
      answer,
      confidence: report.polluted ? 'low' : out.confidence,
      sources: dedupedSources,
    },
    report,
  }
}

export function isLensId(value: string): value is LensId {
  return (LENS_IDS as readonly string[]).includes(value)
}
