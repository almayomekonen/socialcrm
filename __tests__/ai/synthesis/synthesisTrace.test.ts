import { describe, it, expect, vi } from 'vitest'
import {
  buildSynthesisTrace,
  emitSynthesisTrace,
  traceSynthesis,
} from '@/lib/copilot/general/synthesis/synthesisTrace'
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
const trace = (states: BusinessState[], startedAt = 1000, now = 1005) =>
  buildSynthesisTrace({ states, startedAt, now })

describe('buildSynthesisTrace — telemetry', () => {
  it('records detected candidates (count + summary)', () => {
    const t = trace(coldCluster)
    expect(t.candidateCount).toBe(1)
    expect(t.candidates).toEqual([{ condition: 'GOING_COLD', support: 40, scale: 1 }])
  })

  it('records the selected candidate and its materiality breakdown', () => {
    const t = trace(coldCluster)
    expect(t.selected?.condition).toBe('GOING_COLD')
    expect(t.selected?.materiality).toBe(1)
    expect(t.selected?.breakdown).toEqual({ scale: 1, support: 40, gate: 1, score: 1 })
  })

  it('records observation category and evidence count when surfaced', () => {
    const t = trace(coldCluster)
    expect(t.silenceReason).toBeNull()
    expect(t.observationCategory).toBe('cluster')
    expect(t.evidenceCount).toBe(3)
  })

  it('silenceReason = no_candidates for empty states', () => {
    const t = trace([])
    expect(t.silenceReason).toBe('no_candidates')
    expect(t.observationCategory).toBeNull()
    expect(t.evidenceCount).toBe(0)
  })

  it('silenceReason = below_floor for a sub-floor cluster', () => {
    const t = trace([st('1', 'GOING_COLD', 2), st('2', 'GOING_COLD', 2)])
    expect(t.silenceReason).toBe('below_floor')
    expect(t.selected).toBeNull()
  })

  it('records execution duration (now - startedAt, never negative)', () => {
    expect(trace(coldCluster, 1000, 1042).durationMs).toBe(42)
    expect(trace(coldCluster, 1000, 900).durationMs).toBe(0)
  })

  it('is deterministic for identical input', () => {
    expect(trace(coldCluster)).toEqual(trace(coldCluster))
  })
})

describe('emitSynthesisTrace / traceSynthesis — passive', () => {
  it('emit is quiet in tests and never throws', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    expect(() => emitSynthesisTrace(trace(coldCluster))).not.toThrow()
    expect(spy).not.toHaveBeenCalled() // NODE_ENV==='test' → quiet
    spy.mockRestore()
  })

  it('traceSynthesis never throws (best-effort)', () => {
    expect(() => traceSynthesis({ states: coldCluster, startedAt: 1000, now: 1005 })).not.toThrow()
    expect(() => traceSynthesis({ states: [], startedAt: 1000, now: 1005 })).not.toThrow()
  })
})
