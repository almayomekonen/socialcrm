import { z } from 'zod'

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
  'Google Drive',
])

export const LeadAskAnswerSchema = z.object({
  answer: z
    .string()
    .min(6)
    .max(2500)
    .describe(
      'תשובה תפעולית. בדרך כלל 1-3 פסקאות קצרות ללא רשימות. רשימה (ממוספרת או נקודות) מותרת ורצויה כשמציגים קבצים מ-Google Drive או כשהשאלה מבקשת ניסוח/טיוטה.',
    ),
  confidence: z.enum(['low', 'medium', 'high']).describe('low אם המידע דליל; medium ברירת מחדל; high רק כשיש דפוס מובהק.'),
  sources: z.array(AskSourceCategory).max(3).describe('1-3 קטגוריות מהרשימה הקבועה. ריק אם התשובה היא הצהרה כללית.'),
})

export type LeadAskAnswer = z.infer<typeof LeadAskAnswerSchema>

export function isLensId(value: string): value is LensId {
  return (LENS_IDS as readonly string[]).includes(value)
}

export const LENS_LABEL_HE: Record<LensId, string> = {
  conversations: 'שיחות אחרונות וקצב מעקב',
  tasks: 'משימות ומעקבים',
  notes: 'הערות מילוליות',
  files: 'קבצים שצורפו',
}
