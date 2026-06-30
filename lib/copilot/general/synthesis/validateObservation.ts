/**
 * Executive Synthesis — Trust Gate adapter (C6, v1.0).
 *
 * Pure, deterministic, O(n). Validates an Observation's evidence against the
 * Business State: every evidenceRefId must correspond to a real state. Invalid
 * ids are removed; if none remain the observation is dropped (null). statement,
 * materiality, and category are never touched. This is membership validation
 * only — no recommendation, ranking, suppression, or orchestration, and no
 * dependency on the frozen reasoning Trust Gate (validate.ts).
 */
import type { BusinessState } from '../businessState'
import type { Observation } from './types'

export function validateObservation(observation: Observation, states: BusinessState[]): Observation | null {
  const validIds = new Set(states.map((s) => s.refId))
  const evidenceRefIds = observation.evidenceRefIds.filter((id) => validIds.has(id))
  if (evidenceRefIds.length === 0) return null
  return { ...observation, evidenceRefIds }
}
