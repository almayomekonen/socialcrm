/**
 * Unit tests for the M3 Event Interpretation Runtime (pure, no DB).
 * Runs under `test:unit` (VITEST_NO_DB=1): the module imports only contract
 * types, so it has no database or runtime dependency.
 */
import { describe, it, expect } from 'vitest'
import {
  interpret,
  DEFAULT_SOURCE_RELIABILITY,
  type ExternalSignal,
  type InterpretationResult,
  type Rejection,
} from '@/lib/ai/runtime/eventInterpretation'

// `strictNullChecks` is off in this project, so TypeScript will not narrow a
// boolean-literal discriminant in the negative direction: after `if (!accepted)`
// it still sees the whole union and `.rejection` fails to resolve. The rejected
// member is therefore named explicitly rather than relying on that narrowing.
type RejectedResult = { accepted: false; rejection: Rejection }

const iso = '2026-07-01T12:00:00.000Z'

function base(over: Partial<ExternalSignal> & Pick<ExternalSignal, 'signalType'>): ExternalSignal {
  return {
    scope: { agencyId: 42 },
    source: { kind: 'counterpart', id: 'wa-123' },
    occurredAt: iso,
    subject: { subjectType: 'lead', subjectId: '100' },
    traceRefs: [{ type: 'message', id: 'msg-1' }],
    ...over,
  }
}

function expectAccepted(r: InterpretationResult) {
  if (!r.accepted) {
    const { rejection } = r as RejectedResult
    throw new Error(`expected accepted, got rejection ${rejection.code}: ${rejection.message}`)
  }
  return r.event
}

function expectRejected(r: InterpretationResult): Rejection {
  if (r.accepted) throw new Error('expected rejection, got accepted')
  return (r as RejectedResult).rejection
}

describe('M3 Event Interpretation — inbound observations', () => {
  it('normalizes a grounded message into a canonical inbound_trace', () => {
    const ev = expectAccepted(interpret(base({ signalType: 'message' })))
    expect(ev.kind).toBe('inbound_trace')
    if (ev.kind !== 'inbound_trace') return
    const s = ev.signal
    expect(s.signalType).toBe('message')
    expect(s.scope).toEqual({ agencyId: 42 })
    expect(s.subject).toEqual({ subjectType: 'lead', subjectId: '100' })
    expect(s.asOfTime).toBe(iso)
    expect(s.provenance.traceRefs).toEqual([{ type: 'message', id: 'msg-1' }])
    expect(s.provenance.inferentialDistance).toBe('low') // stamped at first touch
    expect(s.provenance.inferencePath).toEqual([])
    expect(s.sourceReliability).toBe(DEFAULT_SOURCE_RELIABILITY.counterpart)
    expect(s.absenceMarker).toBeNull()
    expect(s.isAbsenceDerived).toBe(false)
    expect(s.surprise).toBeNull() // never computed at ingress
  })

  it('accepts status_change and system_event when grounded', () => {
    expect(expectAccepted(interpret(base({ signalType: 'status_change' }))).kind).toBe('inbound_trace')
    expect(
      expectAccepted(interpret(base({ signalType: 'system_event', source: { kind: 'system' } }))).kind,
    ).toBe('inbound_trace')
  })

  it('rejects an ungrounded observation (no trace)', () => {
    expect(expectRejected(interpret(base({ signalType: 'message', traceRefs: [] }))).code).toBe('ungrounded_observation')
    expect(expectRejected(interpret(base({ signalType: 'status_change', traceRefs: undefined }))).code).toBe(
      'ungrounded_observation',
    )
  })

  it('emits no belief and no confidence — only a Signal', () => {
    const ev = expectAccepted(interpret(base({ signalType: 'message' })))
    if (ev.kind !== 'inbound_trace') return
    expect('confidence' in ev.signal).toBe(false)
    expect('content' in ev.signal).toBe(false)
  })
})

describe('M3 Event Interpretation — inferential distance', () => {
  it('preserves a supplied higher inferential distance (never lowers it)', () => {
    const ev = expectAccepted(interpret(base({ signalType: 'message', inferentialDistance: 'medium' })))
    if (ev.kind !== 'inbound_trace') return
    expect(ev.signal.provenance.inferentialDistance).toBe('medium')
  })

  it('rejects an invalid inferential distance', () => {
    const bad = base({ signalType: 'message' })
    ;(bad as { inferentialDistance: unknown }).inferentialDistance = 'certain'
    expect(expectRejected(interpret(bad)).code).toBe('invalid_inferential_distance')
  })
})

describe('M3 Event Interpretation — source weighting', () => {
  it('applies the policy default per source kind', () => {
    const ev = expectAccepted(interpret(base({ signalType: 'message', source: { kind: 'integration' } })))
    if (ev.kind !== 'inbound_trace') return
    expect(ev.signal.sourceReliability).toBe(DEFAULT_SOURCE_RELIABILITY.integration)
  })

  it('honors an explicit in-range override', () => {
    const ev = expectAccepted(interpret(base({ signalType: 'message', sourceReliability: 0.33 })))
    if (ev.kind !== 'inbound_trace') return
    expect(ev.signal.sourceReliability).toBe(0.33)
  })

  it('rejects an out-of-range reliability and an invalid source kind', () => {
    expect(expectRejected(interpret(base({ signalType: 'message', sourceReliability: 1.5 }))).code).toBe(
      'invalid_source_reliability',
    )
    const badSource = base({ signalType: 'message' })
    ;(badSource as { source: unknown }).source = { kind: 'oracle' }
    expect(expectRejected(interpret(badSource)).code).toBe('invalid_source')
  })
})

describe('M3 Event Interpretation — elapsed time & absence (first-class)', () => {
  it('normalizes an elapsed-time tick carrying current time, no provenance', () => {
    const ev = expectAccepted(interpret(base({ signalType: 'elapsed_time', traceRefs: undefined })))
    expect(ev.kind).toBe('elapsed_time_tick')
    if (ev.kind !== 'elapsed_time_tick') return
    expect(ev.scope).toEqual({ agencyId: 42 })
    expect(ev.asOfTime).toBe(iso)
  })

  it('normalizes an absence into absence_detected, absence-derived, no trace required', () => {
    const ev = expectAccepted(
      interpret(
        base({
          signalType: 'absence',
          traceRefs: [],
          source: { kind: 'system' },
          absence: { violatedExpectation: 'promised_callback', expectedBy: iso },
        }),
      ),
    )
    expect(ev.kind).toBe('absence_detected')
    if (ev.kind !== 'absence_detected') return
    expect(ev.signal.isAbsenceDerived).toBe(true)
    expect(ev.signal.absenceMarker?.violatedExpectation).toBe('promised_callback')
    expect(ev.signal.provenance.traceRefs).toEqual([])
    expect(ev.signal.surprise).toBeNull()
  })

  it('rejects an absence with no violated expectation', () => {
    expect(
      expectRejected(interpret(base({ signalType: 'absence', traceRefs: [], source: { kind: 'system' } }))).code,
    ).toBe('missing_absence_marker')
  })
})

describe('M3 Event Interpretation — malformed inputs', () => {
  it('rejects a missing or invalid scope', () => {
    const noScope = base({ signalType: 'message' })
    ;(noScope as { scope: unknown }).scope = undefined
    expect(expectRejected(interpret(noScope)).code).toBe('missing_scope')
    expect(expectRejected(interpret(base({ signalType: 'message', scope: { agencyId: 0 } }))).code).toBe('invalid_scope')
    expect(expectRejected(interpret(base({ signalType: 'message', scope: { agencyId: 1.5 } }))).code).toBe(
      'invalid_scope',
    )
  })

  it('rejects an unknown signal type', () => {
    const bad = base({ signalType: 'message' })
    ;(bad as { signalType: unknown }).signalType = 'telepathy'
    expect(expectRejected(interpret(bad)).code).toBe('unknown_signal_type')
  })

  it('rejects an invalid time', () => {
    expect(expectRejected(interpret(base({ signalType: 'message', occurredAt: 'not-a-date' }))).code).toBe(
      'invalid_time',
    )
  })

  it('rejects a malformed trace ref', () => {
    const bad = base({ signalType: 'message' })
    ;(bad as { traceRefs: unknown }).traceRefs = [{ type: 'message' }]
    expect(expectRejected(interpret(bad)).code).toBe('invalid_trace_ref')
  })

  it('normalizes epoch and Date occurredAt to ISO', () => {
    const epoch = Date.parse(iso)
    const a = expectAccepted(interpret(base({ signalType: 'message', occurredAt: epoch })))
    const b = expectAccepted(interpret(base({ signalType: 'message', occurredAt: new Date(epoch) })))
    if (a.kind !== 'inbound_trace' || b.kind !== 'inbound_trace') return
    expect(a.signal.asOfTime).toBe(iso)
    expect(b.signal.asOfTime).toBe(iso)
  })
})
