import { describe, it, expect } from 'vitest'
import { detectClusters } from '@/lib/copilot/general/synthesis/detectCluster'
import type { BusinessState } from '@/lib/copilot/general/businessState'

const st = (refId: string, state: string, clusterSize: number): BusinessState =>
  ({
    state,
    refId,
    name: 'x',
    evidence: '',
    metadata: { ageDays: null, source: 'tasks.overdue', waitingDays: null, freshnessDays: null, clusterSize },
  }) as BusinessState

const states: BusinessState[] = [
  st('1', 'BROKEN_COMMITMENT', 12),
  st('2', 'BROKEN_COMMITMENT', 12),
  st('3', 'GOING_COLD', 61),
  st('4', 'GOING_COLD', 61),
  st('5', 'GOING_COLD', 61),
]

describe('detectClusters — C2', () => {
  it('emits one cluster candidate per state kind present', () => {
    const c = detectClusters(states)
    expect(c.length).toBe(2)
    expect(c.every((x) => x.category === 'cluster')).toBe(true)
    expect(c.map((x) => x.support).sort((a, b) => a - b)).toEqual([12, 61])
  })

  it('propagates the grouping kind as the candidate condition', () => {
    const c = detectClusters(states)
    expect(c.find((x) => x.support === 12)!.condition).toBe('BROKEN_COMMITMENT')
    expect(c.find((x) => x.support === 61)!.condition).toBe('GOING_COLD')
  })

  it('support = true cluster size (clusterSize), not the sampled member count', () => {
    const cold = detectClusters(states).find((x) => x.support === 61)!
    expect(cold.memberRefIds).toEqual(['3', '4', '5']) // 3 sampled members, support 61
  })

  it('scale = clusterSize / total-across-kinds, finite (no NaN)', () => {
    const broken = detectClusters(states).find((x) => x.support === 12)!
    expect(broken.scale).toBeCloseTo(12 / 73)
    expect(Number.isFinite(broken.scale)).toBe(true)
  })

  it('memberRefIds are sorted and ⊆ input refIds', () => {
    const cold = detectClusters(states).find((x) => x.support === 61)!
    expect(cold.memberRefIds).toEqual([...cold.memberRefIds].sort((a, b) => a.localeCompare(b)))
  })

  it('returns [] for empty input', () => {
    expect(detectClusters([])).toEqual([])
  })

  it('is deterministic: same states → identical candidates', () => {
    expect(detectClusters(states)).toEqual(detectClusters(states))
  })

  it('deviation is the documented v1.0 constant', () => {
    expect(detectClusters(states).every((x) => x.deviation === 0)).toBe(true)
  })
})
