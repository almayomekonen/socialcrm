/**
 * Executive Synthesis — Materiality evaluator (C3, v1.0).
 *
 * Pure, deterministic. Maps a Candidate to a ScoredCandidate using the frozen
 * v1.0 design: magnitude only (scale), gated by a minimum support floor.
 * `deviation` is intentionally inert in v1.0. This module only computes a score
 * and its breakdown — it does not rank, select, suppress, or orchestrate.
 */
import type { Candidate, ScoredCandidate } from './types'

/** Minimum cluster size to be material. v1.0 default; calibrated by telemetry. */
const N_MIN = 3

export function scoreMateriality(c: Candidate): ScoredCandidate {
  const gate = c.support >= N_MIN ? 1 : 0
  const score = c.scale * gate
  return {
    ...c,
    materiality: score,
    breakdown: { scale: c.scale, support: c.support, gate, score },
  }
}
