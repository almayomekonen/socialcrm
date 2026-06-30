import { describe, it, expect } from 'vitest'
import { select } from '@/lib/copilot/general/synthesis/select'
import type { ScoredCandidate } from '@/lib/copilot/general/synthesis/types'

const sc = (over: Partial<ScoredCandidate> = {}): ScoredCandidate => ({
  category: 'cluster',
  condition: 'GOING_COLD',
  memberRefIds: ['1'],
  scale: 0.5,
  deviation: 0,
  support: 5,
  materiality: 0.5,
  breakdown: { scale: 0.5, support: 5, gate: 1, score: 0.5 },
  ...over,
})

describe('select — C4', () => {
  it('returns the candidate with the highest materiality', () => {
    const r = select([
      sc({ materiality: 0.3, memberRefIds: ['1'] }),
      sc({ materiality: 0.8, memberRefIds: ['2'] }),
      sc({ materiality: 0.5, memberRefIds: ['3'] }),
    ])
    expect(r?.materiality).toBe(0.8)
  })

  it('breaks ties deterministically by smallest member refId', () => {
    const a = sc({ materiality: 0.5, memberRefIds: ['5', '9'] })
    const b = sc({ materiality: 0.5, memberRefIds: ['3', '7'] })
    expect(select([a, b])).toBe(b) // min refId '3' < '5'
  })

  it('returns null when the top candidate is below the silence floor', () => {
    expect(select([sc({ materiality: 0.1 })])).toBeNull()
  })

  it('returns null for empty input', () => {
    expect(select([])).toBeNull()
  })

  it('rejects malformed candidates (empty memberRefIds) instead of letting them win', () => {
    const malformed = sc({ materiality: 0.9, memberRefIds: [] })
    const valid = sc({ materiality: 0.5, memberRefIds: ['3'] })
    expect(select([malformed, valid])).toBe(valid) // malformed cannot win on materiality
    expect(select([malformed])).toBeNull() // malformed-only → silence, no manufactured key
  })

  it('output is finite and deterministic', () => {
    const arr = [sc({ materiality: 0.4, memberRefIds: ['1'] }), sc({ materiality: 0.7, memberRefIds: ['2'] })]
    expect(select(arr)).toBe(select(arr))
    expect(Number.isFinite(select(arr)!.materiality)).toBe(true)
  })

  it('does not mutate the input array', () => {
    const arr = [sc({ materiality: 0.3, memberRefIds: ['9'] }), sc({ materiality: 0.8, memberRefIds: ['1'] })]
    const order = [...arr]
    select(arr)
    expect(arr).toEqual(order)
  })
})
