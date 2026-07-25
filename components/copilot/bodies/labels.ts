import type { LeadFollowup } from '@/lib/ai/prompts/leadFollowup'
import type { LeadNextStep } from '@/lib/ai/prompts/leadNextStep'
import type { CopilotResponseErrorReason } from '@/lib/copilot/copilotResponse'

export const CHANNEL_LABEL: Record<LeadFollowup['channel'], string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'מייל',
  phone: 'טלפון',
}

export const TONE_LABEL: Record<LeadFollowup['tone'], string> = {
  warm: 'טון חמים',
  direct: 'טון ישיר',
  apologetic: 'טון מתנצל',
}

export const CONFIDENCE_LABEL: Record<'low' | 'medium' | 'high', string> = {
  high: 'ביטחון גבוה',
  medium: 'ביטחון בינוני',
  low: 'ביטחון נמוך',
}

export const URGENCY_LABEL: Record<LeadNextStep['urgency'], string> = {
  now: 'דחוף',
  'this-week': 'השבוע',
  'when-possible': 'כשאפשר',
}

export const ERROR_COPY: Record<CopilotResponseErrorReason, string> = {
  disabled: 'העוזר החכם כבוי כרגע.',
  forbidden: 'העוזר החכם לא זמין לסוכנות זו.',
  'no-providers': 'אין ספק AI מוגדר. פנה למנהל המערכת.',
  'over-quota': 'הגעת למגבלת השימוש היומית.',
  'all-providers-failed': 'הניסוח נכשל. נסה שוב בעוד רגע.',
  'invalid-input': 'הקלט לא תקין או שהפלט נדחה. נסה שוב.',
  'subscription-required': 'תקופת ה-Pro הסתיימה. כדי להמשיך להשתמש ב-AI יש להפעיל מנוי.',
  'trial-not-started': 'יש להתחיל את תקופת הניסיון כדי להשתמש ב-AI.',
  unknown: 'משהו השתבש. נסה שוב.',
}
