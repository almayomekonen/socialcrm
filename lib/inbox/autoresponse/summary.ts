/**
 * AI Lead Qualifier — internal operator summary (pure, no I/O). Built ONLY from
 * the structured qualification (every field came from what the customer said) and
 * the escalation reason — never AI free-text, so it cannot hallucinate. Missing
 * fields render as "—"/"not provided". This note is internal and never sent to
 * the customer.
 */
import type { Qualification } from './qualification'

export type Temperature = 'hot' | 'warm' | 'cold'

/**
 * "מיידי" did NOT match the previous pattern: `מיד` is not a substring of
 * `מיידי` (מ-י-י-ד-י). So a customer answering "כן אשמח במיידי!" produced a WARM
 * lead instead of a hot one, and the urgency they stated was quietly downgraded
 * in the very note a rep reads. postHandoff.detectUrgent already carried
 * `מיידי`; this copy did not.
 *
 * The bare `מיד` is anchored on whitespace rather than `\b`, which is an ASCII
 * word boundary and never matches beside a Hebrew letter.
 */
const URGENT_RE =
  /דחוף|מייד|מיידי|מידי|(?:^|\s)מיד(?:$|\s|[,.!])|עכשיו|בהקדם|גבוה|urgent|asap|immediately|right now|high/i

export function deriveTemperature(reason: string, q: Qualification): Temperature {
  if (reason === 'hot_signal') return 'hot'
  if (reason === 'qualified') return URGENT_RE.test(q.urgency ?? '') ? 'hot' : 'warm'
  return 'warm' // max_turns / uncertain — engaged but not clearly hot
}

const ACTION = {
  hot: { he: 'צרו קשר טלפוני בהקדם — ליד חם', en: 'Call the lead soon — hot lead' },
  warm: { he: 'חזרו ללקוח עם פרטים מתאימים', en: 'Follow up with relevant details' },
  uncertain: { he: 'בדקו את הפנייה — ה-AI לא היה בטוח', en: 'Review the conversation — the AI was unsure' },
} as const

export interface EscalationSummary {
  temperature: Temperature
  suggestedAction: string
  text: string
}

const F = (v: string | undefined, dash: string): string => (v && v.trim() ? v.trim() : dash)

export function buildSummary(args: {
  qualification: Qualification
  reason: string
  turnCount: number
  lang: 'he' | 'en'
}): EscalationSummary {
  const { qualification: q, reason, turnCount, lang } = args
  const temperature = deriveTemperature(reason, q)
  const actionKey = reason === 'uncertain' ? 'uncertain' : temperature === 'hot' ? 'hot' : 'warm'
  const suggestedAction = ACTION[actionKey][lang]
  const dash = lang === 'he' ? '—' : '—'
  const text =
    lang === 'he'
      ? [
          '🤖 סיכום AI — לא נשלח ללקוח',
          `שם: ${F(q.name, 'לא נמסר')}`,
          `סוג העסק: ${F(q.businessType, dash)}`,
          `צורך: ${F(q.need, dash)}`,
          `דחיפות: ${F(q.urgency, dash)}`,
          `תקציב: ${F(q.budget, dash)}`,
          `מיקום: ${F(q.location, dash)}`,
          `חזרה: ${F(q.callback, dash)}`,
          `טמפרטורה: ${temperature}`,
          `הצעד הבא: ${suggestedAction}`,
          `סיבת הסלמה: ${reason}`,
          `הודעות AI: ${turnCount}`,
        ].join('\n')
      : [
          '🤖 AI summary — not sent to the customer',
          `Name: ${F(q.name, 'not provided')}`,
          `Need: ${F(q.need, dash)}`,
          `Urgency: ${F(q.urgency, dash)}`,
          `Budget: ${F(q.budget, dash)}`,
          `Location: ${F(q.location, dash)}`,
          `Callback: ${F(q.callback, dash)}`,
          `Temperature: ${temperature}`,
          `Next step: ${suggestedAction}`,
          `Escalation reason: ${reason}`,
          `AI turns: ${turnCount}`,
        ].join('\n')
  return { temperature, suggestedAction, text }
}
