import type { RuntimeCognition } from '@/lib/copilot/general/runtimeCognition'
import { type Qualification, type QualificationField, QUALIFICATION_FIELDS } from './qualification'

/**
 * Runtime-aware qualification DECISION + gap SELECTION (Wave 3).
 *
 * This is the Conversation Engine's decision layer — pure orchestration, no
 * reasoning. It combines three owners, each staying in its lane:
 *
 *   • Business POLICY (qualifier config): the required fields and their PRIORITY
 *     (the order of the required list), the confidence threshold, and MAX_AI_TURNS.
 *   • Runtime COGNITION (from the existing Copilot bridge — M5/M6): how confident
 *     the Runtime is in what it already believes, and where it is still uncertain.
 *     The Runtime NEVER enumerates missing fields and NEVER ranks business value.
 *   • Conversation STATE: what has been collected, the AI turn count.
 *
 * From those it computes `missing = required − known` (a config/state set-
 * difference, never Runtime cognition), selects the next field by configured
 * priority, and returns CONTINUE vs HANDOFF. It performs no reasoning, writes no
 * text, and generates no questions — it only decides and points at the gap.
 *
 * STOP (customer requested a human / opt-out) and the "wait for customer" silence
 * are already owned by the existing `decidePreGeneration`; this module owns only
 * the Runtime-informed CONTINUE-vs-HANDOFF choice and the gap.
 */

export type ConversationDecision = 'CONTINUE' | 'HANDOFF' | 'STOP' | 'STAY_SILENT'

export const DEFAULT_RUNTIME_QUALIFICATION_CONFIDENCE_THRESHOLD = 0.8

/** Config: the highest confidence at which the Runtime's read alone can trigger handoff. */
export function runtimeQualificationConfidenceThreshold(): number {
  const raw = Number(process.env.RUNTIME_QUALIFICATION_CONFIDENCE_THRESHOLD)
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : DEFAULT_RUNTIME_QUALIFICATION_CONFIDENCE_THRESHOLD
}

/**
 * Per-agency canary flag, default OFF. Empty/unset allowlist → off everywhere, so
 * the qualifier behaves exactly as today. RUNTIME_QUALIFICATION_KILL=1 is the
 * global backstop.
 */
export function isRuntimeQualificationEnabled(agencyId: number | null | undefined): boolean {
  const kill = process.env.RUNTIME_QUALIFICATION_KILL
  if (kill === '1' || kill === 'true') return false
  const raw = (process.env.RUNTIME_QUALIFICATION_AGENCY_IDS ?? '').trim()
  if (!raw) return false
  if (raw === 'all') return true
  if (!agencyId) return false
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .includes(agencyId)
}

export interface RuntimeQualificationInput {
  /** Collected qualification so far (conversation state). */
  qualification: Qualification
  /** Required fields, in configured PRIORITY order (business policy). */
  required: readonly string[]
  /** AI turns already sent in this conversation. */
  turnCount: number
  maxTurns: number
  /** Runtime cognition for this lead (from the bridge), or null when unavailable. */
  cognition: RuntimeCognition | null
  confidenceThreshold: number
}

export interface RuntimeQualificationDecision {
  decision: ConversationDecision
  /** The next field to collect (config priority) when CONTINUE; null otherwise. */
  gap: QualificationField | null
  reason: string
  /** Numeric Runtime confidence used (max reasoning-chain credence), for logs/summary. */
  confidence: number | null
  /** Required fields still missing (config − known). */
  missing: QualificationField[]
}

const isKnownField = (q: Qualification, f: string): boolean => {
  const v = q[f as QualificationField]
  return typeof v === 'string' && v.trim().length > 0
}

/** Numeric Runtime confidence = the strongest resident belief's credence. */
function numericConfidence(c: RuntimeCognition | null): number | null {
  if (!c || !c.grounded || c.reasoningChain.length === 0) return null
  return Math.max(...c.reasoningChain.map((r) => r.credence))
}

/**
 * Select the next field to ask — the highest-priority MISSING required field per
 * configuration order. Never selects a known field (never repeats). Config owns
 * the priority; the Runtime does not.
 */
export function selectNextGap(qualification: Qualification, required: readonly string[]): QualificationField | null {
  for (const f of required) {
    if (QUALIFICATION_FIELDS.includes(f as QualificationField) && !isKnownField(qualification, f)) {
      return f as QualificationField
    }
  }
  return null
}

/**
 * Decide CONTINUE vs HANDOFF using configuration + Runtime cognition + state.
 * Pure and deterministic — no reasoning, no text.
 */
export function decideRuntimeQualification(input: RuntimeQualificationInput): RuntimeQualificationDecision {
  const missing = input.required.filter(
    (f) => QUALIFICATION_FIELDS.includes(f as QualificationField) && !isKnownField(input.qualification, f),
  ) as QualificationField[]
  const confidence = numericConfidence(input.cognition)

  // HANDOFF — any of: required fields complete (policy+state); Runtime confident
  // enough that further asking adds little (cognition + config threshold); or the
  // AI turn budget is spent (config). Config decides what's required and the
  // thresholds; the Runtime only supplies its confidence.
  if (missing.length === 0) {
    return { decision: 'HANDOFF', gap: null, reason: 'Required qualification fields collected.', confidence, missing }
  }
  if (confidence !== null && confidence >= input.confidenceThreshold) {
    return {
      decision: 'HANDOFF',
      gap: null,
      reason: `Runtime confidence ${confidence.toFixed(2)} ≥ configured threshold ${input.confidenceThreshold}.`,
      confidence,
      missing,
    }
  }
  if (input.turnCount >= input.maxTurns) {
    return { decision: 'HANDOFF', gap: null, reason: `Maximum AI turns (${input.maxTurns}) reached.`, confidence, missing }
  }

  // CONTINUE — collect the highest-priority missing field (config order). The
  // Runtime's uncertainty is surfaced to inform HOW the question is framed, but
  // the SELECTION stays with configured priority; the Runtime never ranks fields.
  const gap = missing[0]
  const uncertaintyNote = input.cognition?.openQuestions.length
    ? ` (Runtime still uncertain on: ${input.cognition.openQuestions.join(', ')})`
    : ''
  return {
    decision: 'CONTINUE',
    gap,
    reason: `Collecting '${gap}' — highest-priority missing field per configuration${uncertaintyNote}.`,
    confidence,
    missing,
  }
}

/**
 * Fixed product objective for the conversation policy. Deterministic and stated
 * here in code — the LLM never invents or negotiates it. Every ASK/HANDOFF is
 * evaluated against this single sentence.
 */
export const CONVERSATION_OBJECTIVE =
  "Collect only information that materially improves the business owner's ability to continue the sale."

export interface ConversationPolicyInput {
  /** Collected qualification so far (conversation state). */
  qualification: Qualification
  /** Required fields = the business owner's definition of materially-relevant info. */
  required: readonly string[]
  /** AI turns already sent in this conversation. */
  turnCount: number
  maxTurns: number
}

export interface ConversationPolicyDecision {
  decision: 'ASK' | 'HANDOFF'
  /** The next required field to ask when ASK (config priority, via Gap Selection); null on HANDOFF. */
  gap: QualificationField | null
  reason: string
}

/**
 * The single ASK/HANDOFF decision (product evolution). One deterministic rule:
 *
 *   ASK the next missing REQUIRED field while AI turns remain; otherwise HANDOFF.
 *
 * The required fields ARE the business owner's definition of what materially
 * improves the sale ({@link CONVERSATION_OBJECTIVE}). Once they are all collected
 * the qualified lead is handed over immediately — we never ask optional follow-up
 * questions past the required floor. This keeps a single AI generation, avoids
 * unnecessary conversation, and keeps `gen.reply` (focused on the same required
 * gap) aligned with what is asked. If an agency needs more qualification, the
 * answer is to add a configurable REQUIRED field, not an optional follow-up.
 *
 * The Runtime still shapes HOW the question is phrased (its cognition and the
 * focus field feed generation upstream); it simply does not gate this decision.
 * No confidence thresholds, no magic numbers — only the reused Gap Selection and
 * the existing `maxTurns` bound.
 */
export function decideConversationPolicy(input: ConversationPolicyInput): ConversationPolicyDecision {
  const gap = selectNextGap(input.qualification, input.required)
  if (gap !== null && input.turnCount < input.maxTurns) {
    return { decision: 'ASK', gap, reason: `collecting required field '${gap}'` }
  }
  return {
    decision: 'HANDOFF',
    gap: null,
    reason: gap === null ? 'required fields complete — hand off the qualified lead' : 'max AI turns reached',
  }
}
