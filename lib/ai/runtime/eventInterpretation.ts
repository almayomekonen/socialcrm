import type { Scope, SubjectRef, TraceRef, InferenceStep, InferentialDistance, ProvenanceView } from '@/db/ai/stateManagement'

export type CanonicalSignalType = 'message' | 'status_change' | 'system_event' | 'elapsed_time' | 'absence'

export type SourceKind = 'counterpart' | 'operator' | 'system' | 'integration' | 'inferred'

export interface SignalSource {
  kind: SourceKind
  id?: string
}

export interface AbsenceMarker {
  violatedExpectation: string
  expectedBy?: string
  sinceLastSignalAt?: string
}

export interface ExternalSignal {
  signalType: CanonicalSignalType
  scope: Scope
  source: SignalSource
  occurredAt: string | number | Date
  subject?: SubjectRef
  traceRefs?: TraceRef[]
  inferencePath?: InferenceStep[]
  inferentialDistance?: InferentialDistance
  sourceReliability?: number
  absence?: AbsenceMarker
  payload?: Record<string, unknown>
}

/** The canonical M0 §1.4 Signal produced by the ingress. */
export interface CanonicalSignal {
  signalType: CanonicalSignalType
  scope: Scope
  subject: SubjectRef | null
  source: SignalSource
  sourceReliability: number
  asOfTime: string
  provenance: ProvenanceView
  absenceMarker: AbsenceMarker | null
  isAbsenceDerived: boolean
  surprise: null
}

/** The canonical Wave-1 ingress runtime events (M0 Part 3). */
export type RuntimeEvent =
  | { kind: 'inbound_trace'; signal: CanonicalSignal }
  | { kind: 'elapsed_time_tick'; scope: Scope; asOfTime: string }
  | { kind: 'absence_detected'; signal: CanonicalSignal }

export type RejectionCode =
  | 'missing_scope'
  | 'invalid_scope'
  | 'unknown_signal_type'
  | 'invalid_time'
  | 'invalid_source'
  | 'invalid_source_reliability'
  | 'invalid_inferential_distance'
  | 'invalid_trace_ref'
  | 'ungrounded_observation'
  | 'missing_absence_marker'

export interface Rejection {
  code: RejectionCode
  message: string
}

export type InterpretationResult = { accepted: true; event: RuntimeEvent } | { accepted: false; rejection: Rejection }

export const DEFAULT_SOURCE_RELIABILITY: Record<SourceKind, number> = {
  system: 1.0,
  operator: 0.95,
  counterpart: 0.9,
  integration: 0.7,
  inferred: 0.5,
}

const SIGNAL_TYPES: readonly CanonicalSignalType[] = ['message', 'status_change', 'system_event', 'elapsed_time', 'absence']
const OBSERVATION_TYPES: readonly CanonicalSignalType[] = ['message', 'status_change', 'system_event']
const SOURCE_KINDS: readonly SourceKind[] = ['counterpart', 'operator', 'system', 'integration', 'inferred']
const DISTANCES: readonly InferentialDistance[] = ['low', 'medium', 'high']

function reject(code: RejectionCode, message: string): InterpretationResult {
  return { accepted: false, rejection: { code, message } }
}

function toIso(value: string | number | Date): string | null {
  const d = value instanceof Date ? value : new Date(value)
  const t = d.getTime()
  return Number.isNaN(t) ? null : d.toISOString()
}

function validTraceRefs(refs: TraceRef[] | undefined): { ok: true; refs: TraceRef[] } | { ok: false } {
  if (refs === undefined) return { ok: true, refs: [] }
  if (!Array.isArray(refs)) return { ok: false }
  for (const r of refs) {
    if (!r || typeof r.type !== 'string' || r.type.length === 0 || typeof r.id !== 'string' || r.id.length === 0) {
      return { ok: false }
    }
  }
  return { ok: true, refs }
}

/**
 * Transform one external signal into a canonical runtime event, or reject it.
 * Deterministic and side-effect-free.
 */
export function interpret(external: ExternalSignal): InterpretationResult {
  // — Scope (present from the first touch; scope isolation, Constitution VII.5) —
  if (!external || !external.scope || external.scope.agencyId === undefined || external.scope.agencyId === null) {
    return reject('missing_scope', 'a signal must carry a scope with an agencyId')
  }
  const agencyId = external.scope.agencyId
  if (!Number.isInteger(agencyId) || agencyId <= 0) {
    return reject('invalid_scope', `agencyId must be a positive integer, got ${String(agencyId)}`)
  }
  const scope: Scope = { agencyId }

  // — Signal type —
  if (!SIGNAL_TYPES.includes(external.signalType)) {
    return reject('unknown_signal_type', `unknown signal type '${String(external.signalType)}'`)
  }

  // — As-of time (time is a first-class input) —
  const asOfTime = toIso(external.occurredAt)
  if (asOfTime === null) {
    return reject('invalid_time', `occurredAt is not a valid time: ${String(external.occurredAt)}`)
  }

  // — Elapsed-time tick: a clock signal carrying current time; no provenance. —
  if (external.signalType === 'elapsed_time') {
    return { accepted: true, event: { kind: 'elapsed_time_tick', scope, asOfTime } }
  }

  // — Source + reliability (source weighting is an ingress responsibility) —
  if (!external.source || !SOURCE_KINDS.includes(external.source.kind)) {
    return reject('invalid_source', `source.kind must be one of ${SOURCE_KINDS.join('|')}`)
  }
  const source: SignalSource = { kind: external.source.kind, ...(external.source.id ? { id: external.source.id } : {}) }

  let sourceReliability: number
  if (external.sourceReliability === undefined) {
    sourceReliability = DEFAULT_SOURCE_RELIABILITY[source.kind]
  } else {
    const r = external.sourceReliability
    if (typeof r !== 'number' || Number.isNaN(r) || r < 0 || r > 1) {
      return reject('invalid_source_reliability', `sourceReliability must be a number in [0,1], got ${String(r)}`)
    }
    sourceReliability = r
  }

  // — Inferential distance (preserved, never lowered) —
  const inferentialDistance: InferentialDistance = external.inferentialDistance ?? 'low'
  if (!DISTANCES.includes(inferentialDistance)) {
    return reject('invalid_inferential_distance', `inferentialDistance must be one of ${DISTANCES.join('|')}`)
  }

  // — Trace references —
  const traces = validTraceRefs(external.traceRefs)
  if (!traces.ok) {
    return reject('invalid_trace_ref', 'each traceRef must have a non-empty type and id')
  }

  const subject: SubjectRef | null = external.subject ?? null
  const inferencePath: InferenceStep[] = external.inferencePath ?? []
  const provenance: ProvenanceView = { traceRefs: traces.refs, inferencePath, inferentialDistance }

  // — Absence: grounded by the violated expectation; absence-derived; no trace required. —
  if (external.signalType === 'absence') {
    if (
      !external.absence ||
      typeof external.absence.violatedExpectation !== 'string' ||
      external.absence.violatedExpectation.length === 0
    ) {
      return reject('missing_absence_marker', 'an absence signal must carry a violated expectation')
    }
    const signal: CanonicalSignal = {
      signalType: 'absence',
      scope,
      subject,
      source,
      sourceReliability,
      asOfTime,
      provenance,
      absenceMarker: external.absence,
      isAbsenceDerived: true,
      surprise: null,
    }
    return { accepted: true, event: { kind: 'absence_detected', signal } }
  }

  // — Direct observations: the fabrication ban — must walk back to >=1 trace. —
  if (OBSERVATION_TYPES.includes(external.signalType) && traces.refs.length === 0) {
    return reject('ungrounded_observation', `a '${external.signalType}' signal must reference at least one trace`)
  }

  const signal: CanonicalSignal = {
    signalType: external.signalType,
    scope,
    subject,
    source,
    sourceReliability,
    asOfTime,
    provenance,
    absenceMarker: null,
    isAbsenceDerived: false,
    surprise: null,
  }
  return { accepted: true, event: { kind: 'inbound_trace', signal } }
}
