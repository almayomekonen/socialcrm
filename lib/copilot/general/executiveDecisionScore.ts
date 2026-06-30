/**
 * Executive Decision Score — the PRIMARY quality metric for executive reasoning.
 *
 * This is a MEASUREMENT, not a runtime gate: it scores a produced answer against
 * the bar "did it produce exactly one executive decision?" — consumed by the
 * reasoning trace and canary validation. It does not modify the Reasoner, the
 * prompt, the schema, or the Trust Gate.
 *
 * A successful (decisive) answer satisfies ALL of:
 *   - exactly one primary recommendation;
 *   - one concrete reason;
 *   - one obvious next action;
 *   - no competing recommendations of equal importance;
 *   - no summaries or lists replacing a decision.
 *
 * `allClear` (nothing requires action) is valid silence — scored separately, not
 * as a failed decision.
 */
import type { GeneralReasonOutput } from '@/lib/ai/prompts/generalReason'

export interface ExecutiveDecisionScore {
  /** Decisive answer that meets every criterion (false when allClear). */
  pass: boolean
  /** Valid silence — nothing to decide; excluded from the decisiveness verdict. */
  allClear: boolean
  checks: {
    onePrimaryRecommendation: boolean
    oneConcreteReason: boolean
    oneObviousNextAction: boolean
    noCompetingOfEqualImportance: boolean
    noListOrSummaryInsteadOfDecision: boolean
  }
  failed: string[]
}

const RANK = { high: 0, medium: 1, low: 2 } as const

export function scoreExecutiveDecision(output: GeneralReasonOutput): ExecutiveDecisionScore {
  if (output.allClear) {
    return {
      pass: true,
      allClear: true,
      checks: {
        onePrimaryRecommendation: true,
        oneConcreteReason: true,
        oneObviousNextAction: true,
        noCompetingOfEqualImportance: true,
        noListOrSummaryInsteadOfDecision: true,
      },
      failed: [],
    }
  }

  const actions = output.actions ?? []
  const topRank = actions.length ? Math.min(...actions.map((a) => RANK[a.priority])) : Infinity
  const atTop = actions.filter((a) => RANK[a.priority] === topRank)
  const primary = atTop[0]

  const checks = {
    onePrimaryRecommendation: actions.length >= 1,
    oneConcreteReason: !!primary && primary.why.trim().length > 0,
    oneObviousNextAction: !!primary && primary.action.trim().length > 0,
    noCompetingOfEqualImportance: atTop.length === 1,
    noListOrSummaryInsteadOfDecision: output.executiveDecision.trim().length > 0 && actions.length >= 1,
  }

  const failed = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([k]) => k)

  return { pass: failed.length === 0, allClear: false, checks, failed }
}
