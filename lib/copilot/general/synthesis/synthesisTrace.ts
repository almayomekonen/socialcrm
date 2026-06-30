/**
 * Synthesis Trace — passive observability for Executive Synthesis (canary).
 *
 * Mirrors the Decision Trace convention: a pure builder that re-derives the
 * deterministic pipeline (detect → score → select → build → validate) from the
 * same `states`, plus a quiet, never-throwing emitter. It reads the frozen
 * modules' outputs and modifies none of them; it influences no behavior and no
 * decision. synthesize() is untouched.
 *
 * Because the pipeline is pure and deterministic, re-deriving over the same
 * `states` yields exactly what synthesize() produced — so the trace is faithful.
 */
import type { BusinessState, BusinessStateKind } from '../businessState'
import type { ObservationCategory, ScoredCandidate } from './types'
import { detectClusters } from './detectCluster'
import { scoreMateriality } from './materiality'
import { select } from './select'
import { buildObservation } from './observation'
import { validateObservation } from './validateObservation'

export type SilenceReason = 'no_candidates' | 'below_floor' | 'validation_failure' | null

export interface SynthesisTrace {
  durationMs: number
  candidateCount: number
  candidates: { condition: BusinessStateKind; support: number; scale: number }[]
  selected: { condition: BusinessStateKind; materiality: number; breakdown: ScoredCandidate['breakdown'] } | null
  silenceReason: SilenceReason
  observationCategory: ObservationCategory | null
  evidenceCount: number
}

export interface SynthesisTraceInput {
  states: BusinessState[]
  startedAt: number
  now: number
}

export function buildSynthesisTrace(input: SynthesisTraceInput): SynthesisTrace {
  const { states, startedAt, now } = input

  const candidates = detectClusters(states)
  const scored = candidates.map((c) => scoreMateriality(c))
  const selected = select(scored)

  let silenceReason: SilenceReason
  let observation = null
  if (candidates.length === 0) {
    silenceReason = 'no_candidates'
  } else if (selected === null) {
    silenceReason = 'below_floor'
  } else {
    observation = validateObservation(buildObservation(selected), states)
    silenceReason = observation === null ? 'validation_failure' : null
  }

  return {
    durationMs: Math.max(0, now - startedAt),
    candidateCount: candidates.length,
    candidates: candidates.map((c) => ({ condition: c.condition, support: c.support, scale: c.scale })),
    selected: selected
      ? { condition: selected.condition, materiality: selected.materiality, breakdown: selected.breakdown }
      : null,
    silenceReason,
    observationCategory: observation?.category ?? null,
    evidenceCount: observation?.evidenceRefIds.length ?? 0,
  }
}

/**
 * Emit the trace as a single structured line. Quiet in tests; never throws
 * (observability must not break the user path).
 */
export function emitSynthesisTrace(trace: SynthesisTrace): void {
  if (process.env.NODE_ENV === 'test') return
  try {
    // eslint-disable-next-line no-console
    console.info('[synthesis-trace]', JSON.stringify(trace))
  } catch {
    /* observability is best-effort */
  }
}

/**
 * Consumer-facing entry: build + emit, fully guarded. Can never throw, so it is
 * safe to call on the user path without affecting the answer.
 */
export function traceSynthesis(input: SynthesisTraceInput): void {
  try {
    emitSynthesisTrace(buildSynthesisTrace(input))
  } catch {
    /* observability is best-effort — never affect the user path */
  }
}
