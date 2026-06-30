import { describe, it, expect } from 'vitest'
import { validateObservation } from '@/lib/copilot/general/synthesis/validateObservation'
import type { Observation } from '@/lib/copilot/general/synthesis/types'
import type { BusinessState } from '@/lib/copilot/general/businessState'

const st = (refId: string): BusinessState =>
  ({
    state: 'GOING_COLD',
    refId,
    name: 'x',
    evidence: '',
    metadata: { ageDays: null, source: 'tasks.overdue', waitingDays: null, freshnessDays: null, clusterSize: 1 },
  }) as BusinessState

const states = [st('1'), st('2'), st('3')]

const obs = (over: Partial<Observation> = {}): Observation => ({
  category: 'cluster',
  statement: 'יש קבוצה',
  evidenceRefIds: ['1', '2'],
  materiality: 0.5,
  ...over,
})

describe('validateObservation — C6', () => {
  it('returns a valid observation unchanged', () => {
    const r = validateObservation(obs(), states)!
    expect(r.evidenceRefIds).toEqual(['1', '2'])
    expect(r.statement).toBe('יש קבוצה')
    expect(r.materiality).toBe(0.5)
    expect(r.category).toBe('cluster')
  })

  it('removes invalid refIds', () => {
    const r = validateObservation(obs({ evidenceRefIds: ['1', '9', '2'] }), states)!
    expect(r.evidenceRefIds).toEqual(['1', '2'])
  })

  it('returns null when no valid evidence remains', () => {
    expect(validateObservation(obs({ evidenceRefIds: ['8', '9'] }), states)).toBeNull()
  })

  it('handles duplicate ids deterministically (invalid removed, valid order preserved)', () => {
    const o = obs({ evidenceRefIds: ['1', '1', '9', '2', '9'] })
    expect(validateObservation(o, states)!.evidenceRefIds).toEqual(['1', '1', '2'])
    expect(validateObservation(o, states)).toEqual(validateObservation(o, states))
  })

  it('is deterministic (same input → identical output)', () => {
    const o = obs({ evidenceRefIds: ['3', '9', '1'] })
    expect(validateObservation(o, states)).toEqual(validateObservation(o, states))
  })

  it('does not mutate its inputs', () => {
    const o = obs({ evidenceRefIds: ['1', '9', '2'] })
    const oSnap = JSON.parse(JSON.stringify(o))
    const sSnap = JSON.parse(JSON.stringify(states))
    validateObservation(o, states)
    expect(o).toEqual(oSnap)
    expect(states).toEqual(sSnap)
  })
})
