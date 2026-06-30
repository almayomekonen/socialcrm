/**
 * Trust Gate — the safety core.
 *
 * Deterministic verification (no AI, no heuristics, no guessing). Its single job:
 * never let anything unsupported reach the user. The Reasoner may misjudge; the
 * Trust Gate may not. It validates the STRUCTURED evidence of every action against
 * the current FactsBundle and:
 *   - removes evidence that isn't traceable to a real fact,
 *   - removes any action left without traceable evidence,
 *   - clamps counts to deterministic reality,
 *   - returns null if nothing supportable survives (never rescues, never repairs).
 *
 * Scope boundary (honest + deterministic): the gate validates structured evidence
 * (the refIds an action cites), not free prose. Grounding the wording is the
 * prompt's job; the gate guarantees every surfaced ACTION is evidence-backed.
 *
 * Bias: false negatives are acceptable, false positives are not. When uncertain,
 * it rejects.
 */
import type { GeneralReasonOutput } from '@/lib/ai/prompts/generalReason'
import type { FactsBundle } from './facts/types'

export interface ValidatedAction {
  action: string
  why: string
  /** Deduped, every id present in the FactsBundle. */
  evidence: string[]
  priority: 'high' | 'medium' | 'low'
}

export type RejectionRule = 'no-valid-evidence' | 'all-clear-not-surfaced'

export interface ActionRejection {
  action: string
  rule: RejectionRule
  reason: string
  removedEvidence: string[]
}

/** DEVELOPER-ONLY. Never rendered to users. */
export interface TrustDiagnostics {
  rejectedActions: ActionRejection[]
  trimmedEvidence: { action: string; removed: string[] }[]
  clampedMoreCount: { from: number; to: number } | null
}

export interface ValidatedReasoning {
  allClear: boolean
  executiveDecision: string
  actions: ValidatedAction[]
  moreCount: number
  /** DEVELOPER-ONLY diagnostics — for logs/debugging. MUST NOT be shown to users. */
  diagnostics: TrustDiagnostics
}

function buildValidIds(facts: FactsBundle): Set<string> {
  const ids = new Set<string>()
  for (const g of facts.groups) for (const r of g.rows) ids.add(r.refId)
  return ids
}

function uniq(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }
  return out
}

function sumTotals(facts: FactsBundle): number {
  return facts.groups.reduce((n, g) => n + (g.total > 0 ? g.total : 0), 0)
}

function emptyDiagnostics(): TrustDiagnostics {
  return { rejectedActions: [], trimmedEvidence: [], clampedMoreCount: null }
}

export function validateReasoning(output: GeneralReasonOutput, facts: FactsBundle): ValidatedReasoning | null {
  // All-clear: nothing is surfaced. Normalize to a clean, empty, safe state;
  // any stray actions are removed (never repaired into something shown).
  if (output.allClear) {
    const diagnostics = emptyDiagnostics()
    for (const a of output.actions) {
      diagnostics.rejectedActions.push({
        action: a.action,
        rule: 'all-clear-not-surfaced',
        reason: 'allClear=true → no actions are surfaced',
        removedEvidence: uniq(a.evidence),
      })
    }
    return { allClear: true, executiveDecision: output.executiveDecision, actions: [], moreCount: 0, diagnostics }
  }

  const validIds = buildValidIds(facts)
  const diagnostics = emptyDiagnostics()
  const actions: ValidatedAction[] = []

  for (const a of output.actions) {
    // Strip a leading `refId=` the model may echo from the payload's citation label,
    // so prefixed citations ("refId=15015") match the bare ids in the FactsBundle.
    const distinct = uniq(a.evidence.map((e) => e.replace(/^refId=/, '')))
    const valid = distinct.filter((id) => validIds.has(id))
    const removed = distinct.filter((id) => !validIds.has(id))

    if (valid.length === 0) {
      diagnostics.rejectedActions.push({
        action: a.action,
        rule: 'no-valid-evidence',
        reason: 'no evidence item is traceable to the FactsBundle',
        removedEvidence: removed,
      })
      continue
    }
    if (removed.length > 0) diagnostics.trimmedEvidence.push({ action: a.action, removed })
    actions.push({ action: a.action, why: a.why, evidence: valid, priority: a.priority })
  }

  // Nothing supportable survived → null. Never rescue an invalid answer.
  if (actions.length === 0) return null

  // Clamp moreCount to deterministic reality (it can never exceed what exists).
  const ceiling = Math.max(0, sumTotals(facts) - actions.length)
  const clamped = Math.max(0, Math.min(Math.trunc(output.moreCount), ceiling))
  const clampedMoreCount = clamped !== output.moreCount ? { from: output.moreCount, to: clamped } : null

  return {
    allClear: false,
    executiveDecision: output.executiveDecision,
    actions,
    moreCount: clamped,
    diagnostics: { ...diagnostics, clampedMoreCount },
  }
}
