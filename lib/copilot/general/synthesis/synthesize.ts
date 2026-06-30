/**
 * Executive Synthesis — Orchestrator (C7, v1.0).
 *
 * Pure, deterministic, side-effect free. Wires the approved modules in the
 * frozen order and propagates null:
 *
 *   states → detectClusters → scoreMateriality → select → buildObservation
 *          → validateObservation → Observation | null
 *
 * No objective, conversation, suppression, previous-state, stability, or feature
 * flags. Orchestration only — no business logic, scoring, selection, or
 * validation lives here.
 */
import type { BusinessState } from '../businessState'
import type { Observation } from './types'
import { detectClusters } from './detectCluster'
import { scoreMateriality } from './materiality'
import { select } from './select'
import { buildObservation } from './observation'
import { validateObservation } from './validateObservation'

export function synthesize(states: BusinessState[]): Observation | null {
  const candidates = detectClusters(states)
  if (candidates.length === 0) return null

  const scored = candidates.map((c) => scoreMateriality(c))
  const winner = select(scored)
  if (winner === null) return null

  const observation = buildObservation(winner)
  return validateObservation(observation, states)
}
