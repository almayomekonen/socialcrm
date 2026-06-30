/**
 * Executive Synthesis — Selection (C4, v1.0).
 *
 * Pure, deterministic. Picks the single most-material candidate, or null when
 * none clears the silence floor. Ordering is total and deterministic:
 * materiality desc → category enum order → smallest member refId. It does not
 * suppress, stabilize, validate, or orchestrate.
 */
import type { ScoredCandidate } from './types'

/** v1.0 silence floor on materiality. A candidate must reach it to surface. Calibrated by telemetry. */
const FLOOR = 0.2

/** Fixed category precedence for tie-breaking (v1.0: cluster only). */
const CATEGORY_ORDER: Record<ScoredCandidate['category'], number> = { cluster: 0 }

/** Assumes a non-empty memberRefIds (guaranteed by the eligibility filter below). */
const minRefId = (c: ScoredCandidate): string => c.memberRefIds.reduce((m, r) => (r.localeCompare(m) < 0 ? r : m))

export function select(scored: ScoredCandidate[]): ScoredCandidate | null {
  // Reject malformed candidates (no evidence) — they can never be a valid observation,
  // and must never silently manufacture an ordering key.
  const eligible = scored.filter((c) => c.materiality >= FLOOR && c.memberRefIds.length > 0)
  if (eligible.length === 0) return null

  const ranked = [...eligible].sort((a, b) => {
    if (b.materiality !== a.materiality) return b.materiality - a.materiality
    const cat = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]
    if (cat !== 0) return cat
    return minRefId(a).localeCompare(minRefId(b))
  })
  return ranked[0]
}
