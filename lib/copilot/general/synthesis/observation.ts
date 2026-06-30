/**
 * Executive Synthesis — Observation builder (C5, v1.0).
 *
 * Pure, deterministic. Converts a ScoredCandidate into the single descriptive
 * Observation. The wording names the aggregate condition (from the candidate's
 * `condition`) and the true count — purely factual, with no recommendation,
 * ranking, priority, or decision vocabulary. evidenceRefIds equals memberRefIds
 * exactly. It does not validate, select, suppress, stabilize, or orchestrate.
 */
import type { BusinessStateKind } from '../businessState'
import type { Observation, ScoredCandidate } from './types'

/** Descriptive phrase per condition. Total over BusinessStateKind (tsc-enforced exhaustive). */
const CONDITION_PHRASE: Record<BusinessStateKind, (n: number) => string> = {
  GOING_COLD: (n) => `${n} לידים מתקררים ללא מענה.`,
  BROKEN_COMMITMENT: (n) => `${n} לידים עם משימה באיחור.`,
  WAITING_CUSTOMER: (n) => `${n} לידים ממתינים לתשובה.`,
  FOLLOWUP_DUE: (n) => `${n} לידים עם מעקב להיום.`,
  NEW_LEAD: (n) => `${n} לידים חדשים נכנסו השבוע.`,
}

export function buildObservation(c: ScoredCandidate): Observation {
  return {
    category: c.category,
    statement: CONDITION_PHRASE[c.condition](c.support),
    evidenceRefIds: [...c.memberRefIds],
    materiality: c.materiality,
  }
}
