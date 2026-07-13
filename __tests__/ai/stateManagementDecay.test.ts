/**
 * Unit tests for the M1 confidence-decay / staleness policy (pure, no DB).
 * Runs under `test:unit` (VITEST_NO_DB=1) because it imports no db layer.
 */
import { describe, it, expect } from 'vitest'
import {
  decayConfidence,
  ageMsBetween,
  DEFAULT_DECAY_POLICY,
  type DecayPolicy,
} from '@/db/ai/decay'

const base = new Date('2026-01-01T00:00:00.000Z')
const plus = (ms: number) => new Date(base.getTime() + ms)

const POLICY: DecayPolicy = {
  halfLifeMs: 1000,
  staleAfterMs: 4000,
  floorConfidence: 0,
}

describe('ageMsBetween', () => {
  it('is zero at freshness and never negative', () => {
    expect(ageMsBetween(base, base)).toBe(0)
    expect(ageMsBetween(plus(1000), base)).toBe(0) // clock earlier than freshness
    expect(ageMsBetween(base, plus(2500))).toBe(2500)
  })
})

describe('decayConfidence', () => {
  it('returns stored confidence unchanged at age 0 and is not stale', () => {
    const r = decayConfidence(0.8, base, base, POLICY)
    expect(r.decayedConfidence).toBeCloseTo(0.8, 10)
    expect(r.ageMs).toBe(0)
    expect(r.isStale).toBe(false)
  })

  it('halves the distance to the floor after exactly one half-life', () => {
    const r = decayConfidence(0.8, base, plus(1000), POLICY)
    expect(r.decayedConfidence).toBeCloseTo(0.4, 10)
  })

  it('quarters after two half-lives', () => {
    const r = decayConfidence(0.8, base, plus(2000), POLICY)
    expect(r.decayedConfidence).toBeCloseTo(0.2, 10)
  })

  it('decays toward a non-zero floor without crossing it', () => {
    const withFloor: DecayPolicy = { ...POLICY, floorConfidence: 0.3 }
    const r = decayConfidence(0.9, base, plus(1000), withFloor)
    // floor + (0.9 - 0.3) * 0.5 = 0.3 + 0.3 = 0.6
    expect(r.decayedConfidence).toBeCloseTo(0.6, 10)
    const far = decayConfidence(0.9, base, plus(100_000), withFloor)
    expect(far.decayedConfidence).toBeGreaterThanOrEqual(0.3)
    expect(far.decayedConfidence).toBeCloseTo(0.3, 4)
  })

  it('is monotonically non-increasing as age grows', () => {
    let prev = Infinity
    for (const age of [0, 250, 500, 1000, 2000, 5000, 20_000]) {
      const r = decayConfidence(0.95, base, plus(age), POLICY)
      expect(r.decayedConfidence).toBeLessThanOrEqual(prev + 1e-9)
      prev = r.decayedConfidence
    }
  })

  it('flags stale exactly at and after the staleness horizon', () => {
    expect(decayConfidence(0.5, base, plus(3999), POLICY).isStale).toBe(false)
    expect(decayConfidence(0.5, base, plus(4000), POLICY).isStale).toBe(true)
    expect(decayConfidence(0.5, base, plus(9999), POLICY).isStale).toBe(true)
  })

  it('clamps output to [0,1] for out-of-range stored confidence', () => {
    expect(decayConfidence(1.5, base, base, POLICY).decayedConfidence).toBe(1)
    expect(decayConfidence(-0.5, base, base, POLICY).decayedConfidence).toBe(0)
  })

  it('falls back to the default half-life when a non-positive one is given', () => {
    const bad: DecayPolicy = { ...POLICY, halfLifeMs: 0 }
    const r = decayConfidence(0.8, base, plus(DEFAULT_DECAY_POLICY.halfLifeMs), bad)
    expect(r.decayedConfidence).toBeCloseTo(0.4, 6)
  })
})
