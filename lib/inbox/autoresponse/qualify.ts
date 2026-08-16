import { z } from 'zod'
import { runStructured } from '@/lib/ai/router'
import {
  QUALIFICATION_FIELDS,
  isConversationObjective,
  type ConversationCognition,
  type ConversationObjective,
  type Qualification,
} from './qualification'
import { waTrace, type WaTraceCtx } from './waTrace'
import {
  QUALIFY_SYSTEM_PROMPT,
  buildQualifyUser,
  inboundStatesBusinessNeed,
  inboundStatesImpact,
  inboundStatesOutcome,
  inboundStatesPain,
  inboundStatesWorkflow,
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

export type QualifyFallbackObjective = ConversationObjective

// Objective-aware canned questions. Static copy only — used as the shape-repair
// fallback so a malformed reply never causes a handoff. Each is a single short
// question (one '?', no FORBIDDEN tokens, no digits) so it passes validateAutoResponse.
// Never keyed by a missing CRM field.
const FALLBACK_BY_OBJECTIVE: Record<QualifyFallbackObjective, { he: string; en: string }> = {
  discover_need: { he: 'איך אפשר לעזור?', en: 'How can I help?' },
  understand_pain: { he: 'מה הכי מפריע לך בזה עכשיו?', en: 'What is getting in the way most right now?' },
  understand_impact: { he: 'מה קורה בדרך כלל כשזה לא מסתדר?', en: 'What usually happens when that does not work out?' },
  understand_outcome: { he: 'מה היית רוצה שיהיה אחרת?', en: 'What would you want to be different?' },
  advance: { he: 'מה הכי חשוב לך שנסדר עכשיו?', en: 'What matters most to sort out now?' },
}

function inboundMemoryBlob(args: {
  qualification: Qualification
  lastInboundText: string
  transcript?: Array<{ direction: 'inbound' | 'outbound'; text: string }>
}): string {
  const parts: string[] = []
  if (args.qualification.need) parts.push(args.qualification.need)
  if (args.lastInboundText) parts.push(args.lastInboundText)
  if (args.transcript) {
    for (const m of args.transcript) {
      if (m.direction === 'inbound' && m.text) parts.push(m.text)
    }
  }
  return parts.join('\n')
}

/**
 * Infer the next conversational objective from cognition + inbound text.
 * CRM completeness (missing name, urgency, …) never wins. Not a mandatory funnel:
 * already-stated pain/impact/outcome skips ahead.
 */
export function inferFallbackObjective(args: {
  qualification: Qualification
  lastInboundText: string
  transcript?: Array<{ direction: 'inbound' | 'outbound'; text: string }>
  cognition?: ConversationCognition
}): QualifyFallbackObjective {
  const cog = args.cognition ?? args.qualification.cognition
  const blob = inboundMemoryBlob(args)
  const needKnown = Boolean(args.qualification.need) || inboundStatesBusinessNeed(args.lastInboundText) || inboundStatesBusinessNeed(blob)
  const painKnown = Boolean(cog?.pain) || inboundStatesPain(blob)
  const impactKnown = Boolean(cog?.impact) || inboundStatesImpact(blob)
  const outcomeKnown = Boolean(cog?.desiredOutcome) || inboundStatesOutcome(blob)

  if (!needKnown) return 'discover_need'
  if (!painKnown) return 'understand_pain'
  if (!impactKnown) return 'understand_impact'
  if (!outcomeKnown) return 'understand_outcome'
  return 'advance'
}

export function resolveFallbackObjective(args: {
  qualification: Qualification
  lastInboundText: string
  transcript?: Array<{ direction: 'inbound' | 'outbound'; text: string }>
  cognition?: ConversationCognition
  objective?: ConversationObjective | null
}): QualifyFallbackObjective {
  if (args.objective && isConversationObjective(args.objective)) return args.objective
  const inferred = inferFallbackObjective(args)
  const last = args.cognition?.lastObjective ?? args.qualification.cognition?.lastObjective
  if (last && isConversationObjective(last) && last === inferred) return last
  return inferred
}

/**
 * Shape-repair fallback after a failed regeneration. Chooses a conversational
 * objective, never the next missing CRM field.
 */
export function deterministicQualifyFallback(args: {
  qualification: Qualification
  lastInboundText: string
  lang: 'he' | 'en'
  transcript?: Array<{ direction: 'inbound' | 'outbound'; text: string }>
  cognition?: ConversationCognition
  objective?: ConversationObjective | null
}): string {
  const objective = resolveFallbackObjective(args)
  const q = FALLBACK_BY_OBJECTIVE[objective]
  return args.lang === 'en' ? q.en : q.he
}

export type UnderstandingDelta = {
  pain: string | null
  impact: string | null
  currentWorkflow: string | null
  desiredOutcome: string | null
}

/** Persist only understanding facts whose category is grounded in inbound text. */
export function cognitionFromUnderstanding(
  understanding: UnderstandingDelta | undefined,
  objective: ConversationObjective | null | undefined,
  inboundBlob: string,
): ConversationCognition {
  const out: ConversationCognition = {}
  if (objective && isConversationObjective(objective)) out.lastObjective = objective
  const u = understanding
  if (u?.pain?.trim() && inboundStatesPain(inboundBlob)) out.pain = u.pain.trim()
  if (u?.impact?.trim() && inboundStatesImpact(inboundBlob)) out.impact = u.impact.trim()
  if (u?.currentWorkflow?.trim() && inboundStatesWorkflow(inboundBlob)) out.currentWorkflow = u.currentWorkflow.trim()
  if (u?.desiredOutcome?.trim() && inboundStatesOutcome(inboundBlob)) out.desiredOutcome = u.desiredOutcome.trim()
  return out
}

export function inboundMemoryText(args: {
  qualification: Qualification
  lastInboundText: string
  transcript?: Array<{ direction: 'inbound' | 'outbound'; text: string }>
}): string {
  return inboundMemoryBlob(args)
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
  objective: z
    .enum(['discover_need', 'understand_pain', 'understand_impact', 'understand_outcome', 'advance'])
    .describe('היעד השיחתי בעל הערך הגבוה ביותר עכשיו — לא השדה החסר הבא'),
  understanding: z
    .object({
      pain: z.string().nullable(),
      impact: z.string().nullable(),
      currentWorkflow: z.string().nullable(),
      desiredOutcome: z.string().nullable(),
    })
    .describe('עובדות שיחה שהלקוח מסר בפועל; null אם לא נמסר. לא להמציא'),
  hotSignal: z.boolean().describe('כוונת קנייה חזקה (מחיר/דמו/פגישה/להתחיל/בקשה לדבר עם נציג)'),
  uncertain: z.boolean().describe('לא ניתן לענות באמת בלי להמציא, או שצריך אדם'),
})

export type QualifyGenResult =
  | {
      ok: true
      reply: string
      extracted: Qualification
      objective: ConversationObjective | null
      understanding: UnderstandingDelta
      hotSignal: boolean
      uncertain: boolean
    }
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
  const objective = isConversationObjective(d.objective) ? d.objective : null
  const understanding: UnderstandingDelta = {
    pain: d.understanding?.pain?.trim() || null,
    impact: d.understanding?.impact?.trim() || null,
    currentWorkflow: d.understanding?.currentWorkflow?.trim() || null,
    desiredOutcome: d.understanding?.desiredOutcome?.trim() || null,
  }
  const result = {
    ok: true as const,
    reply: d.reply,
    extracted,
    objective,
    understanding,
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
    objective,
    understanding,
    hotSignal: result.hotSignal,
    uncertain: result.uncertain,
  })
  return result
}
