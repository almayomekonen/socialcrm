import { z } from 'zod'
import { runStructured } from '@/lib/ai/router'
import { QUALIFICATION_FIELDS, type Qualification } from './qualification'
import { waTrace, type WaTraceCtx } from './waTrace'
import {
  QUALIFY_SYSTEM_PROMPT,
  buildQualifyUser,
  inboundStatesBusinessNeed,
  type RegenerationReason,
} from './qualifyPrompt'

export type { RegenerationReason }
export { QUALIFY_SYSTEM_PROMPT }

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
    he: 'מישהו מהצוות ימשיך איתך ויחזור אליך בהקדם.',
    en: 'Someone from the team will continue with you and get back shortly.',
  },
  uncertain: {
    he: 'מישהו מהצוות ימשיך איתך מכאן.',
    en: 'Someone from the team will continue with you from here.',
  },
}

export function handoffMessage(reason: string, lang: 'he' | 'en'): string {
  // Guardrail / leftover uncertain reasons use the shorter team copy.
  // Genuine human reasons (hot_signal, max_turns, qualified) use the continue copy.
  const generic = reason === 'uncertain' || reason === 'guardrail'
  const t = generic ? HANDOFF.uncertain : HANDOFF.qualified
  return lang === 'en' ? t.en : t.he
}

// Deterministic, pre-written question per collectable field. Static copy only —
// used as the shape-repair fallback so a malformed reply never causes a handoff
// and never requires editing the model's text. Each is a single short question
// (one '?', no FORBIDDEN tokens, no digits) so it passes validateAutoResponse.
const NEXT_FIELD_QUESTION: Record<string, { he: string; en: string }> = {
  name: { he: 'איך לפנות אליך?', en: 'What should I call you?' },
  need: { he: 'מה הכי מפריע לך בזה עכשיו?', en: 'What is getting in the way most right now?' },
  urgency: { he: 'זה דחוף לך לימים הקרובים?', en: 'Is this urgent in the next few days?' },
  budget: { he: 'יש טווח תקציב שנוח לך?', en: 'Is there a budget range that works for you?' },
  location: { he: 'מאיפה בארץ?', en: 'Where are you based?' },
  callback: { he: 'מתי נוח לחזור אליך?', en: 'When is a good time to get back to you?' },
}
const GENERIC_QUESTION = { he: 'איך אפשר לעזור?', en: 'How can I help?' }

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

/**
 * Shape-repair fallback after a failed regeneration. `name` may still be missing
 * as CRM memory, but it is not the next conversational question when the customer
 * already stated a need (inbound or extracted).
 */
export function deterministicQualifyFallback(args: {
  missingRequired: string[]
  qualification: Qualification
  lastInboundText: string
  lang: 'he' | 'en'
}): string {
  const needKnown = Boolean(args.qualification.need) || inboundStatesBusinessNeed(args.lastInboundText)
  if (needKnown) {
    const q = NEXT_FIELD_QUESTION.need
    return args.lang === 'en' ? q.en : q.he
  }
  return nextRequiredFieldQuestion(args.missingRequired, args.lang)
}

const QualifySchema = z.object({
  reply: z.string().describe('הודעת וואטסאפ קצרה: תגובה למה שנאמר עכשיו ושאלת הבהרה אחת, 1-2 משפטים'),
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
    system: QUALIFY_SYSTEM_PROMPT,
    user: buildQualifyUser(args),
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
