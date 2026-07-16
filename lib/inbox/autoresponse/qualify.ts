import { z } from 'zod'
import { runStructured } from '@/lib/ai/router'
import { QUALIFICATION_FIELDS, type Qualification } from './qualification'
import { waTrace, type WaTraceCtx } from './waTrace'

// Explicit request to reach a person — a phone call, a meeting, or a human rep.
// This is a HARD handoff signal: the customer asked for a human, so no amount of
// further qualification is appropriate. Kept separate from buying-intent below.
const HUMAN_REQUEST_PATTERNS: RegExp[] = [
  /פגיש|להיפגש|זום|שיחה/, // meeting/call
  /נציג|לדבר עם|בנאדם|אדם אמיתי|שיחזרו? אלי|תתקשרו|תחזרו אלי/, // talk to a human / call me
  /\bmeeting|schedule a (call|meeting)|book a\b/i,
  /talk to (a|someone)|speak (to|with)|call me|representative|\bagent\b|\bhuman\b/i,
]

// Buying intent — interest in price/demo/starting. A SOFT signal: it expresses
// momentum toward a purchase but, on its own, does not mean the conversation
// should end. Whether to ask one more question is decided by the conversation
// policy against the Runtime's cognition, not by these patterns alone.
const BUYING_INTENT_PATTERNS: RegExp[] = [
  /מחיר|תמחור|הצעת מחיר|עלות|בכמה|כמה.{0,12}עול/, // price ("כמה זה עולה", "כמה עולה", "מחיר", …)
  /דמו|הדגמה/, // demo
  /איך מתחיל|להתחיל|להזמין|לקנות|להצטרף/, // how to start / buy
  /\bprice|pricing|cost|quote\b/i,
  /\bdemo\b/i,
  /how (do|can) i (start|begin|buy)|get started|sign ?up/i,
]

// Union of both — the historical "hot signal" set. Unchanged in aggregate so the
// legacy (flag-off) qualifier behaves exactly as before.
const HOT_PATTERNS: RegExp[] = [...HUMAN_REQUEST_PATTERNS, ...BUYING_INTENT_PATTERNS]

export function detectHotSignal(text: string): boolean {
  return HOT_PATTERNS.some((re) => re.test(text))
}

/** Explicit request to reach a person (call / meeting / human rep) → hard handoff. */
export function detectHumanRequest(text: string): boolean {
  return HUMAN_REQUEST_PATTERNS.some((re) => re.test(text))
}

export function detectLang(text: string): 'he' | 'en' {
  return /[֐-׿]/.test(text) ? 'he' : 'en'
}

/**
 * Why a second (repair) generation is being requested. Typed so the reason is
 * explicit and extensible for future validation categories — never a bare flag.
 */
export type RegenerationReason = 'shape_validation' | 'safety_validation'

// Stricter instruction appended to the user prompt on the ONE repair generation.
// Restates the existing SYSTEM rules more forcefully; it is not a rewrite engine
// and never edits the model's output. (These words appear only in the prompt we
// send the model, never in a reply that gets validated.)
const REGEN_CONSTRAINT: Record<RegenerationReason, string> = {
  shape_validation:
    'חשוב מאוד: כתוב/כתבי תשובה קצרה מאוד — שאלת הבהרה אחת בלבד, סימן שאלה אחד, עד שלושה משפטים, בלי מספרים.',
  safety_validation:
    'חשוב מאוד: אל תנקוב/י במחיר, עלות, הנחה, זמינות, מועד, תור, פגישה או התחייבות, ואל תכתוב/י מספרים. שאל/י שאלת הבהרה אחת בלבד.',
}

const OPTOUT_PATTERNS: RegExp[] = [
  /תפסיק|תפסיקו|הסר אותי|להסיר|תורידו אותי|אל תכתבו|הפסיקו|נמאס לי/,
  /\bstop\b|unsubscribe|remove me|opt[ -]?out|leave me alone|do not (contact|message)/i,
]

/** Customer opt-out / unsubscribe request → permanent stop + compliance. */
export function detectOptOut(text: string): boolean {
  return OPTOUT_PATTERNS.some((re) => re.test(text))
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

export function handoffMessage(reason: string, lang: 'he' | 'en'): string {
  // 'uncertain' and safety-guardrail handoffs use the generic team-member copy;
  // completion-style reasons ('qualified', 'hot_signal', 'max_turns', …) keep the
  // "I have enough information" copy. Existing reasons are unaffected.
  const generic = reason === 'uncertain' || reason === 'guardrail'
  const t = generic ? HANDOFF.uncertain : HANDOFF.qualified
  return lang === 'en' ? t.en : t.he
}

// Deterministic, pre-written question per collectable field. Static copy only —
// used as the shape-repair fallback so a malformed reply never causes a handoff
// and never requires editing the model's text. Each is a single short question
// (one '?', no FORBIDDEN tokens, no digits) so it passes validateAutoResponse.
const NEXT_FIELD_QUESTION: Record<string, { he: string; en: string }> = {
  name: { he: 'איך נוכל לפנות אליך?', en: 'How may we address you?' },
  need: { he: 'מה הצורך המרכזי שאיתו נוכל לעזור?', en: 'What is the main need we can help with?' },
  urgency: { he: 'עד כמה זה דחוף עבורך?', en: 'How urgent is this for you?' },
  budget: { he: 'מה טווח התקציב שמתאים לך?', en: 'What budget range works for you?' },
  location: { he: 'באיזה אזור אתה נמצא?', en: 'Which area are you in?' },
  callback: { he: 'מתי יהיה לך נוח שנחזור אליך?', en: 'When is a good time for us to get back to you?' },
}
const GENERIC_QUESTION = { he: 'איך נוכל לעזור לך?', en: 'How can we help you?' }

/**
 * Deterministic fallback question for the next missing REQUIRED field. Used only
 * when a shape-invalid reply could not be repaired by the one allowed
 * regeneration; keeps qualification alive without inventing content or a handoff.
 */
export function nextRequiredFieldQuestion(missingRequired: string[], lang: 'he' | 'en'): string {
  const field = missingRequired[0]
  const q = (field && NEXT_FIELD_QUESTION[field]) || GENERIC_QUESTION
  return lang === 'en' ? q.en : q.he
}

const QualifySchema = z.object({
  reply: z.string().describe('ההודעה הבאה לליד: שאלת הבהרה אחת, חמה, 1-2 משפטים'),
  extracted: z
    .object({
      name: z.string().nullable(),
      need: z.string().nullable(),
      urgency: z.string().nullable(),
      budget: z.string().nullable(),
      location: z.string().nullable(),
      callback: z.string().nullable(),
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
  focusField?: string | null
  runtimeCognition?: string | null
  regenerationReason?: RegenerationReason
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
  // Additive (flag-gated upstream): the Conversation Engine chose the highest-
  // priority missing field; ask exactly it. The Runtime cognition block grounds
  // confidence/framing. Absent → the message is byte-for-byte the existing one.
  if (args.focusField)
    lines.push(`השדה בעל העדיפות הגבוהה ביותר לאיסוף עכשיו: ${args.focusField} — שאל/י שאלה טבעית אחת שממוקדת בו בלבד.`)
  if (args.runtimeCognition) lines.push(args.runtimeCognition)
  // Repair generation: append the stricter constraint for the specific failure.
  if (args.regenerationReason) lines.push(REGEN_CONSTRAINT[args.regenerationReason])
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
  focusField?: string | null
  runtimeCognition?: string | null
  regenerationReason?: RegenerationReason
  trace?: WaTraceCtx
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
    waTrace('RUN_STRUCTURED_RESULT', args.trace ?? {}, { ok: false, reason: out.reason })
    return { ok: false, skipReason: out.reason === 'over-quota' ? 'budget_exhausted' : 'ai_unavailable' }
  }
  const d = out.data as z.infer<typeof QualifySchema>
  const extracted: Qualification = {}
  for (const f of QUALIFICATION_FIELDS) {
    const v = d.extracted?.[f]
    if (v != null && String(v).trim() !== '') extracted[f] = String(v).trim()
  }
  const lastInbound = [...args.transcript].reverse().find((m) => m.direction === 'inbound')?.text ?? ''
  const result = {
    ok: true as const,
    reply: d.reply,
    extracted,
    hotSignal: Boolean(d.hotSignal) || detectHotSignal(lastInbound),
    uncertain: Boolean(d.uncertain),
  }
  waTrace('RUN_STRUCTURED_RESULT', args.trace ?? {}, {
    ok: true,
    provider: out.provider,
    model: out.model,
    usage: { inputTokens: out.inputTokens, outputTokens: out.outputTokens, costUsd: out.costUsd },
    latencyMs: out.latencyMs,
    extracted,
    hotSignal: result.hotSignal,
    uncertain: result.uncertain,
  })
  return result
}
