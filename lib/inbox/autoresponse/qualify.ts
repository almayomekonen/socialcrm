/**
 * AI Lead Qualifier — structured turn generation + deterministic helpers.
 * Reuses the cost-capped, allowlisted runStructured router (same `kind` as the
 * acknowledge path). Output is structured: the next reply, fields extracted from
 * what the customer actually said, plus hot-signal and uncertainty flags. The
 * handoff text is a FIXED template (never AI-generated). Strict guardrails: no
 * prices, no promises, no invented facts — escalate instead of guessing.
 */
import { z } from 'zod'
import { runStructured } from '@/lib/ai/router'
import { QUALIFICATION_FIELDS, type Qualification } from './qualification'

// ── Deterministic helpers (pure, unit-tested) ────────────────────────────────
const HOT_PATTERNS: RegExp[] = [
  /מחיר|תמחור|הצעת מחיר|עלות|בכמה|כמה.{0,12}עול/, // price ("כמה זה עולה", "כמה עולה", "מחיר", …)
  /דמו|הדגמה/, // demo
  /פגיש|להיפגש|זום|שיחה/, // meeting/call
  /איך מתחיל|להתחיל|להזמין|לקנות|להצטרף/, // how to start / buy
  /נציג|לדבר עם|בנאדם|אדם אמיתי|שיחזרו? אלי|תתקשרו|תחזרו אלי/, // talk to a human / call me
  /\bprice|pricing|cost|quote\b/i,
  /\bdemo\b/i,
  /\bmeeting|schedule a (call|meeting)|book a\b/i,
  /how (do|can) i (start|begin|buy)|get started|sign ?up/i,
  /talk to (a|someone)|speak (to|with)|call me|representative|\bagent\b|\bhuman\b/i,
]

/** Deterministic buying-intent detector — a safety net beside the model's own hotSignal. */
export function detectHotSignal(text: string): boolean {
  return HOT_PATTERNS.some((re) => re.test(text))
}

/** Pick the handoff language from the customer's text. */
export function detectLang(text: string): 'he' | 'en' {
  return /[֐-׿]/.test(text) ? 'he' : 'en'
}

const HANDOFF = {
  qualified: {
    he: 'מעולה, יש לי מספיק מידע. אני מעביר את הפרטים שלך לאחד מאנשי הצוות שלנו שיחזור אליך בהקדם.',
    en: 'Great, I have enough information. I’m forwarding your details to a team member who will contact you shortly.',
  },
  uncertain: {
    he: 'אני מעביר אותך לאחד מאנשי הצוות שלנו שיוכל לעזור.',
    en: 'Let me connect you with a team member who can help.',
  },
}

/** Fixed handoff template by escalation reason + language. Never AI-generated. */
export function handoffMessage(reason: string, lang: 'he' | 'en'): string {
  const t = reason === 'uncertain' ? HANDOFF.uncertain : HANDOFF.qualified
  return lang === 'en' ? t.en : t.he
}

// ── Structured generation ────────────────────────────────────────────────────
const QualifySchema = z.object({
  reply: z.string().describe('ההודעה הבאה לליד: שאלת הבהרה אחת, חמה, 1-2 משפטים'),
  extracted: z
    .object({
      name: z.string().nullable().optional(),
      need: z.string().nullable().optional(),
      urgency: z.string().nullable().optional(),
      budget: z.string().nullable().optional(),
      location: z.string().nullable().optional(),
      callback: z.string().nullable().optional(),
    })
    .describe('עובדות שהלקוח מסר בפועל עד כה; null אם לא נמסר'),
  hotSignal: z.boolean().describe('כוונת קנייה חזקה (מחיר/דמו/פגישה/להתחיל/בקשה לדבר עם נציג)'),
  uncertain: z.boolean().describe('לא ניתן לענות באמת בלי להמציא, או שצריך אדם'),
})

const SYSTEM = [
  'אתה עוזר/ת לעסק לתשאל ולחמם ליד חדש שכתב בוואטסאפ. המטרה: לאסוף מידע ולהעביר לנציג אנושי בזמן הנכון.',
  '- שאל/י שאלת הבהרה אחת בלבד בכל הודעה, חמה וקצרה (1-2 משפטים).',
  '- אל תחזור/חזרי על מידע שכבר נאסף.',
  '- חלץ/י ל-extracted רק עובדות שהלקוח מסר בפועל; null אם לא נמסר.',
  '- hotSignal=true אם הלקוח מביע כוונת קנייה חזקה.',
  '- uncertain=true אם אינך יכול/ה לענות באמת בלי להמציא, או שצריך אדם.',
  '- אסור בתכלית: לנקוב במחיר/עלות/הנחה/זמינות/מועד/תור/פגישה; להבטיח או להתחייב; להמציא עובדה על העסק; לכתוב מספרים. אם חסר מידע — שאל/י או העבר/י לנציג, אל תמציא/י.',
  '- כתוב/כתבי בעברית, בגוף ראשון רבים, מקצועי וחם.',
].join('\n')

function buildUser(args: {
  transcript: Array<{ direction: 'inbound' | 'outbound'; text: string }>
  qualification: Qualification
  collectFields: { required: string[]; optional: string[] }
  guidance: string | null
}): string {
  const convo = args.transcript.map((m) => `${m.direction === 'inbound' ? 'לקוח' : 'אנחנו'}: ${m.text}`).join('\n')
  const have = Object.entries(args.qualification)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ')
  const missingReq = args.collectFields.required.filter((f) => !args.qualification[f as keyof Qualification])
  const lines = [
    `שיחה עד כה:\n${convo || '(ריק)'}`,
    `מידע שכבר נאסף: ${have || '(אין)'}`,
    `שדות חובה שעוד חסרים: ${missingReq.join(', ') || '(הושלמו)'}`,
  ]
  if (args.guidance) lines.push(`הקשר עסקי (לרקע בלבד, לא לציטוט כעובדה): ${args.guidance}`)
  return lines.join('\n\n')
}

export type QualifyGenResult =
  | { ok: true; reply: string; extracted: Qualification; hotSignal: boolean; uncertain: boolean }
  | { ok: false; skipReason: 'ai_unavailable' | 'budget_exhausted' }

export async function generateQualifyTurn(args: {
  agencyId: number
  transcript: Array<{ direction: 'inbound' | 'outbound'; text: string }>
  qualification: Qualification
  collectFields: { required: string[]; optional: string[] }
  guidance: string | null
}): Promise<QualifyGenResult> {
  const out = await runStructured({
    kind: 'inbox.autoResponse',
    schema: QualifySchema,
    schemaName: 'QualifyTurn',
    system: SYSTEM,
    user: buildUser(args),
    agencyId: args.agencyId,
  })
  if (out.ok === false) {
    return { ok: false, skipReason: out.reason === 'over-quota' ? 'budget_exhausted' : 'ai_unavailable' }
  }
  const d = out.data as z.infer<typeof QualifySchema>
  const extracted: Qualification = {}
  for (const f of QUALIFICATION_FIELDS) {
    const v = d.extracted?.[f]
    if (v != null && String(v).trim() !== '') extracted[f] = String(v).trim()
  }
  const lastInbound = [...args.transcript].reverse().find((m) => m.direction === 'inbound')?.text ?? ''
  return {
    ok: true,
    reply: d.reply,
    extracted,
    hotSignal: Boolean(d.hotSignal) || detectHotSignal(lastInbound),
    uncertain: Boolean(d.uncertain),
  }
}
