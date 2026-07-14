import { reason as defaultReason } from '@/lib/ai/runtime/reasoning'
import { decide as defaultDecide } from '@/lib/ai/runtime/toolAction'
import { recall as defaultRecall } from '@/lib/ai/runtime/memory'
import type { CognitionRequest } from '@/lib/ai/runtime/scheduler'
import type { Scope, SubjectRef } from '@/db/ai/stateManagement'

/**
 * Copilot → AI Runtime cognition bridge.
 *
 * The Copilot is the bridge between the CRM (operational facts) and the AI Runtime
 * (the cognitive engine). This module is the ONLY place the Copilot reaches into
 * the Runtime, and it does so exclusively through the Runtime's public cognition
 * interfaces — Memory recall (W2-M2), Reasoning (M5), and the Tool/Action gate
 * (M6). It never queries ai_* tables, never re-derives beliefs, and never invents
 * anything: it asks the Runtime what it already understands about one relationship
 * and returns that understanding as a structured, LLM-ready block.
 *
 * Boundaries kept perfectly clean:
 *   • Facts (who/what/when/status) are NOT this module's job — they come from CRM
 *     read models, elsewhere in the orchestrator.
 *   • Cognition (beliefs, confidence, uncertainty, provenance, recommendation,
 *     memory) is owned by the Runtime; this module only reads it.
 *   • The Runtime's graded beliefs are never converted into deterministic
 *     BusinessStates — they remain a separate cognitive input.
 *   • If the Runtime has no resident beliefs for the subject, cognition is
 *     `grounded: false` — the Copilot then says so honestly rather than guessing.
 *
 * Read-only and fully guarded: a Runtime failure can never break the Copilot;
 * callers fall back to the existing (CRM + legacy) path.
 */

export type Confidence = 'high' | 'medium' | 'low'

export interface RuntimeCognition {
  leadId: string
  /** False when the Runtime holds no belief about this subject — cognition unavailable. */
  grounded: boolean
  confidence: Confidence | null
  /** Second-order groundedness of the leading read (how well-supported), 0..1. */
  groundedness: number | null
  /** The kinds of uncertainty present (epistemic = investigable, aleatoric = irreducible). */
  uncertaintyKinds: Array<'epistemic' | 'aleatoric'>
  /** Human-readable provenance sources the understanding walks back to. */
  provenanceSources: string[]
  anyStale: boolean
  /** Belief keys still contested / not decision-stable (the open questions). */
  openQuestions: string[]
  /** The Runtime's terminal decision for this subject. */
  recommendation: { outcome: 'recommend' | 'stay_silent' | 'none'; rationale: string | null }
  /** The exact reasoning chain that produced the read (key → leaning @ credence). */
  reasoningChain: Array<{ key: string; leaning: string; credence: number }>
  /** Recalled priors/continuity, if any (episodic case count + base-rate count). */
  memory: { episodicCount: number; baseRateCount: number }
}

export interface RuntimeCognitionDeps {
  reason?: typeof defaultReason
  decide?: typeof defaultDecide
  recall?: typeof defaultRecall
}

export interface RuntimeCognitionOptions {
  now?: Date
  deps?: RuntimeCognitionDeps
}

const UNGROUNDED = (leadId: string): RuntimeCognition => ({
  leadId,
  grounded: false,
  confidence: null,
  groundedness: null,
  uncertaintyKinds: [],
  provenanceSources: [],
  anyStale: false,
  openQuestions: [],
  recommendation: { outcome: 'none', rationale: null },
  reasoningChain: [],
  memory: { episodicCount: 0, baseRateCount: 0 },
})

function toConfidence(leadingCredence: number, anyHighInference: boolean): Confidence {
  let c: Confidence = leadingCredence >= 0.8 ? 'high' : leadingCredence >= 0.6 ? 'medium' : 'low'
  // A high-inference (far-from-observation) read is never presented as high confidence.
  if (anyHighInference && c === 'high') c = 'medium'
  return c
}

function traceLabel(type: string): string {
  if (type === 'conversation') return 'WhatsApp conversation'
  if (type === 'message') return 'message'
  if (type === 'status_change') return 'status change'
  return type
}

/**
 * Read the Runtime's cognition for one lead. Guarded; returns `grounded: false`
 * on any error or when the Runtime holds no belief for the subject.
 */
export async function getRuntimeCognitionForLead(
  scope: Scope,
  leadId: number | string,
  opts: RuntimeCognitionOptions = {},
): Promise<RuntimeCognition> {
  const subjectId = String(leadId)
  const now = opts.now ?? new Date()
  const reason = opts.deps?.reason ?? defaultReason
  const decide = opts.deps?.decide ?? defaultDecide
  const recall = opts.deps?.recall ?? defaultRecall
  const subject: SubjectRef = { subjectType: 'lead', subjectId }

  try {
    const request: CognitionRequest = { scope, subject, tier: 2, reason: 'inbound', admittedAt: now.toISOString() }
    const understanding = await reason(request, { now })
    if (!understanding.isGrounded || understanding.questions.length === 0) return UNGROUNDED(subjectId)

    const decision = decide(understanding, { scope, now })

    // Memory priors (continuity) — supplementary; never blocks the read.
    let memory = { episodicCount: 0, baseRateCount: 0 }
    try {
      const recalled = await recall({ scope, subject }, { now })
      memory = { episodicCount: recalled.episodic.length, baseRateCount: recalled.semantic.length }
    } catch {
      // memory is optional enrichment
    }

    const settled = understanding.questions.filter((q) => q.decisionStable)
    const pool = settled.length > 0 ? settled : understanding.questions
    const leadingCredence = Math.max(0, ...pool.map((q) => q.leading.credence))

    const provenanceSources = Array.from(
      new Set(understanding.questions.flatMap((q) => q.provenance.traceRefs.map((t) => traceLabel(t.type)))),
    )

    const outcome: RuntimeCognition['recommendation']['outcome'] = decision.emitted ? decision.outcome : 'none'
    const rationale =
      decision.emitted && decision.outcome === 'recommend'
        ? decision.recommendation.rationale
        : decision.emitted
          ? 'nothing decision-stable enough to surface yet'
          : null

    return {
      leadId: subjectId,
      grounded: true,
      confidence: toConfidence(leadingCredence, understanding.uncertainty.anyHighInference),
      groundedness: pool.length ? Math.max(...pool.map((q) => q.leading.groundedness)) : null,
      uncertaintyKinds: Array.from(new Set(understanding.questions.map((q) => q.uncertaintyKind))),
      provenanceSources,
      anyStale: understanding.uncertainty.anyStale,
      openQuestions: understanding.openQuestions,
      recommendation: { outcome, rationale },
      reasoningChain: understanding.questions.map((q) => ({
        key: q.key,
        leaning: q.leading.label,
        credence: q.leading.credence,
      })),
      memory,
    }
  } catch {
    // Any Runtime failure → cognition unavailable; caller falls back gracefully.
    return UNGROUNDED(subjectId)
  }
}

/** Batch read for several leads (e.g. a triage-resolved set). Guarded per lead. */
export async function getRuntimeCognition(
  scope: Scope,
  leadIds: Array<number | string>,
  opts: RuntimeCognitionOptions = {},
): Promise<RuntimeCognition[]> {
  return Promise.all(leadIds.map((id) => getRuntimeCognitionForLead(scope, id, opts)))
}

/**
 * Render one lead's Runtime cognition as an instruction block for the synthesis
 * LLM. The LLM must treat this as authoritative for confidence/uncertainty/
 * provenance/recommendation and must not invent beyond it. Returns null when the
 * Runtime is not grounded (nothing to add — the answer stays on CRM facts).
 */
export function formatRuntimeCognitionBlock(c: RuntimeCognition): string | null {
  if (!c.grounded) return null
  const lines: string[] = []
  lines.push('--- AI Runtime cognition (authoritative for confidence / uncertainty / provenance / recommendation; do not invent beyond it) ---')
  if (c.confidence) lines.push(`Confidence: ${c.confidence}`)
  if (c.provenanceSources.length) lines.push(`Grounded in: ${c.provenanceSources.join(', ')}`)
  if (c.openQuestions.length) lines.push(`Still unknown / unresolved: ${c.openQuestions.join(', ')}`)
  if (c.uncertaintyKinds.length) lines.push(`Uncertainty kind: ${c.uncertaintyKinds.join(', ')}`)
  if (c.anyStale) lines.push('Note: some of this understanding is stale (not recently observed).')
  if (c.recommendation.outcome === 'recommend' && c.recommendation.rationale)
    lines.push(`Runtime recommendation: ${c.recommendation.rationale}`)
  else if (c.recommendation.outcome === 'stay_silent')
    lines.push('Runtime recommendation: stay silent — nothing settled enough to act on yet.')
  if (c.reasoningChain.length)
    lines.push('Reasoning: ' + c.reasoningChain.map((r) => `${r.key} → ${r.leaning} (${r.credence.toFixed(2)})`).join('; '))
  return lines.join('\n')
}

/**
 * Aggregate the Runtime's per-candidate cognition into one block for the General-
 * Mode executive synthesis. This is orchestration only — it formats cognition the
 * Runtime already produced per subject; it performs no ranking, no selection, and
 * no Runtime call. Selection stays with the CRM situation picture; the Runtime
 * merely explains each candidate. Returns null when nothing is grounded.
 */
export function formatRuntimeCognitionForCandidates(items: Array<{ label: string; cognition: RuntimeCognition }>): string | null {
  const blocks = items
    .map(({ label, cognition }) => {
      const block = formatRuntimeCognitionBlock(cognition)
      return block ? `• ${label}:\n${block}` : null
    })
    .filter((b): b is string => b !== null)
  if (blocks.length === 0) return null
  return (
    'AI Runtime cognition per candidate (understanding only — selection stays with the situation picture; do NOT rank, prioritize, or invent beyond this):\n\n' +
    blocks.join('\n\n')
  )
}
