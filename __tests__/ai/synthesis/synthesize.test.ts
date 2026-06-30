import { describe, it, expect } from 'vitest'
import { synthesize } from '@/lib/copilot/general/synthesis/synthesize'
import type { BusinessState } from '@/lib/copilot/general/businessState'

const st = (refId: string, state: string, clusterSize: number): BusinessState =>
  ({
    state,
    refId,
    name: 'x',
    evidence: '',
    metadata: { ageDays: null, source: 'tasks.overdue', waitingDays: null, freshnessDays: null, clusterSize },
  }) as BusinessState

const coldCluster = [st('101', 'GOING_COLD', 40), st('102', 'GOING_COLD', 40), st('103', 'GOING_COLD', 40)]

describe('synthesize — C7', () => {
  it('returns null for empty states', () => {
    expect(synthesize([])).toBeNull()
  })

  it('returns an Observation for a material cluster', () => {
    const o = synthesize(coldCluster)!
    expect(o.category).toBe('cluster')
    expect(o.statement).toContain('40')
  })

  it('returns null when the cluster is below the materiality floor', () => {
    expect(synthesize([st('1', 'GOING_COLD', 2), st('2', 'GOING_COLD', 2)])).toBeNull()
  })

  it('emits only membership-validated evidence (validateObservation wired in)', () => {
    const o = synthesize(coldCluster)!
    const ids = new Set(coldCluster.map((s) => s.refId))
    expect(o.evidenceRefIds.length).toBeGreaterThan(0)
    expect(o.evidenceRefIds.every((id) => ids.has(id))).toBe(true)
  })

  it('is deterministic (same states → identical output)', () => {
    expect(synthesize(coldCluster)).toEqual(synthesize(coldCluster))
  })

  it('does not mutate states', () => {
    const snap = JSON.parse(JSON.stringify(coldCluster))
    synthesize(coldCluster)
    expect(coldCluster).toEqual(snap)
  })

  it('returned statement contains no decision vocabulary', () => {
    const forbidden = ['כדאי', 'מומלץ', 'צריך', 'תעדף', 'עדיפות', 'דחוף', 'קריטי', 'הכי', 'ראשון', 'תחליט', 'פעל']
    const o = synthesize(coldCluster)!
    for (const w of forbidden) expect(o.statement).not.toContain(w)
  })
})
