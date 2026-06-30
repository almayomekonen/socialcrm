import { describe, it, expect } from 'vitest'
import { scoreMateriality } from '@/lib/copilot/general/synthesis/materiality'
import type { Candidate } from '@/lib/copilot/general/synthesis/types'

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  category: 'cluster',
  condition: 'GOING_COLD',
  memberRefIds: ['1', '2', '3'],
  scale: 0.4,
  deviation: 0,
  support: 5,
  ...over,
})

describe('scoreMateriality — C3', () => {
  it('is deterministic', () => {
    const c = cand()
    expect(scoreMateriality(c)).toEqual(scoreMateriality(c))
  })

  it('is monotonic in scale (support above n_min)', () => {
    const lo = scoreMateriality(cand({ scale: 0.2 }))
    const hi = scoreMateriality(cand({ scale: 0.6 }))
    expect(hi.materiality).toBeGreaterThan(lo.materiality)
  })

  it('support below n_min → score 0 (gate 0)', () => {
    const s = scoreMateriality(cand({ support: 2, scale: 0.9 }))
    expect(s.materiality).toBe(0)
    expect(s.breakdown.gate).toBe(0)
  })

  it('score is always finite (never NaN/Infinity)', () => {
    for (const c of [cand(), cand({ scale: 0 }), cand({ support: 0 }), cand({ scale: 1, support: 1000 })]) {
      expect(Number.isFinite(scoreMateriality(c).materiality)).toBe(true)
    }
  })

  it('breakdown is preserved exactly', () => {
    const s = scoreMateriality(cand({ scale: 0.4, support: 5 }))
    expect(s.breakdown).toEqual({ scale: 0.4, support: 5, gate: 1, score: 0.4 })
  })

  it('does not mutate the input candidate', () => {
    const c = cand()
    const snapshot = JSON.parse(JSON.stringify(c))
    scoreMateriality(c)
    expect(c).toEqual(snapshot)
  })
})
