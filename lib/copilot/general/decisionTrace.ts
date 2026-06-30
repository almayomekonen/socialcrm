/**
 * Decision Trace — the canonical artifact that explains WHY a recommendation
 * existed. Not a model-execution debugger: a stage-by-stage record of how raw
 * facts became one executive decision (or why the pipeline fell back).
 *
 * Stages (always these, in order):
 *   Facts → Business States → Executive Situation Report → Executive Decision →
 *   Evidence → Trust Validation → Final Answer
 *
 * Assembled entirely at the orchestration layer from artifacts already flowing
 * through it (states + report are recomputed deterministically from facts). It
 * reads the frozen modules' outputs; it modifies none of them.
 *
 * It also carries the Decision Success signal that feeds the Decision Success
 * Rate KPI (see executiveDecisionScore).
 */
import type { FactsBundle } from './facts/types'
import type { Objective } from './objective'
import type { GeneralReasonOutput } from '@/lib/ai/prompts/generalReason'
import type { ValidatedReasoning } from './validate'
import { classifyStates } from './businessState'
import { buildSituationReport } from './situationReport'
import { scoreExecutiveDecision, type ExecutiveDecisionScore } from './executiveDecisionScore'

export type DecisionOutcome = 'answered' | 'fallback'
export type DecisionStage =
  | 'facts'
  | 'states'
  | 'situationReport'
  | 'executiveDecision'
  | 'evidence'
  | 'trustValidation'
  | 'finalAnswer'

export interface DecisionTrace {
  outcome: DecisionOutcome
  /** Stage at which the pipeline fell back (null when answered). */
  terminatedAt: DecisionStage | null
  objective: Objective
  latencyMs: number
  /** KPI signal: a delivered, non-allClear, decisive answer. allClear is excluded. */
  decisionSuccess: boolean
  allClear: boolean
  stages: {
    facts: { totalBySource: Record<string, number>; sampledRows: number }
    states: { countByState: Record<string, number> } | null
    situationReport: { text: string; chars: number } | null
    executiveDecision: { decision: string; actionCount: number; allClear: boolean } | null
    evidence: { cited: string[]; valid: string[]; removed: string[] } | null
    trustValidation:
      | { survivingActions: number; rejected: number; trimmed: number; clampedMoreCount: { from: number; to: number } | null }
      | null
    finalAnswer: { decision: string; actionCount: number; moreCount: number } | null
  }
  score: ExecutiveDecisionScore | null
}

export interface DecisionTraceInput {
  objective: Objective
  startedAt: number
  now: number
  outcome: DecisionOutcome
  terminatedAt?: DecisionStage | null
  facts: FactsBundle
  reasoned?: GeneralReasonOutput | null
  validated?: ValidatedReasoning | null
}

function factIds(facts: FactsBundle): Set<string> {
  const s = new Set<string>()
  for (const g of facts.groups) for (const r of g.rows) s.add(r.refId)
  return s
}

export function buildDecisionTrace(input: DecisionTraceInput): DecisionTrace {
  const { objective, facts, reasoned, validated } = input
  const states = classifyStates(facts)

  const totalBySource: Record<string, number> = {}
  let sampledRows = 0
  for (const g of facts.groups) {
    totalBySource[g.source] = g.total
    sampledRows += g.rows.length
  }

  const countByState: Record<string, number> = {}
  for (const s of states) {
    countByState[s.state] = (countByState[s.state] ?? 0) + 1
  }

  const reportText = buildSituationReport(objective, states, facts)

  let evidence: DecisionTrace['stages']['evidence'] = null
  if (reasoned) {
    const ids = factIds(facts)
    const cited = reasoned.actions.flatMap((a) => a.evidence)
    evidence = {
      cited,
      valid: cited.filter((id) => ids.has(id)),
      removed: cited.filter((id) => !ids.has(id)),
    }
  }

  const trustValidation: DecisionTrace['stages']['trustValidation'] = validated
    ? {
        survivingActions: validated.actions.length,
        rejected: validated.diagnostics.rejectedActions.length,
        trimmed: validated.diagnostics.trimmedEvidence.length,
        clampedMoreCount: validated.diagnostics.clampedMoreCount,
      }
    : null

  // Score the surfaced answer when present, else what the model produced (for fallback insight).
  const scored = validated ?? reasoned ?? null
  const score = scored ? scoreExecutiveDecision(scored) : null
  const allClear = scored?.allClear ?? false
  const decisionSuccess = input.outcome === 'answered' && !allClear && score?.pass === true

  return {
    outcome: input.outcome,
    terminatedAt: input.terminatedAt ?? null,
    objective,
    latencyMs: Math.max(0, input.now - input.startedAt),
    decisionSuccess,
    allClear,
    stages: {
      facts: { totalBySource, sampledRows },
      states: { countByState },
      situationReport: { text: reportText, chars: reportText.length },
      executiveDecision: reasoned
        ? { decision: reasoned.executiveDecision, actionCount: reasoned.actions.length, allClear: reasoned.allClear }
        : null,
      evidence,
      trustValidation,
      finalAnswer: validated
        ? { decision: validated.executiveDecision, actionCount: validated.actions.length, moreCount: validated.moreCount }
        : null,
    },
    score,
  }
}

/**
 * Emit the trace as a single structured line — the canonical debugging artifact +
 * the source of the Decision Success Rate and latency KPIs for the canary. Quiet
 * in tests; never throws (observability must not break the user path).
 */
export function emitDecisionTrace(trace: DecisionTrace): void {
  if (process.env.NODE_ENV === 'test') return
  try {
    // eslint-disable-next-line no-console
    console.info('[decision-trace]', JSON.stringify(trace))
  } catch {
    /* observability is best-effort */
  }
}
