export interface DecayPolicy {
  halfLifeMs: number
  staleAfterMs: number
  floorConfidence: number
}

export const DEFAULT_DECAY_POLICY: DecayPolicy = {
  halfLifeMs: 14 * 24 * 60 * 60 * 1000,
  staleAfterMs: 30 * 24 * 60 * 60 * 1000,
  floorConfidence: 0,
}

export interface DecayResult {
  decayedConfidence: number
  ageMs: number
  isStale: boolean
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.min(1, Math.max(0, n))
}

export function ageMsBetween(freshnessAt: Date, now: Date): number {
  return Math.max(0, now.getTime() - freshnessAt.getTime())
}

export function decayConfidence(
  storedConfidence: number,
  freshnessAt: Date,
  now: Date,
  policy: DecayPolicy = DEFAULT_DECAY_POLICY,
): DecayResult {
  const ageMs = ageMsBetween(freshnessAt, now)
  const floor = clamp01(policy.floorConfidence)
  const base = clamp01(storedConfidence)
  const halfLife = policy.halfLifeMs > 0 ? policy.halfLifeMs : DEFAULT_DECAY_POLICY.halfLifeMs
  const factor = Math.pow(0.5, ageMs / halfLife)
  const decayed = floor + (base - floor) * factor
  return {
    decayedConfidence: clamp01(decayed),
    ageMs,
    isStale: ageMs >= policy.staleAfterMs,
  }
}
