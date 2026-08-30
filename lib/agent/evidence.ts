import type { EvidenceEntityKind, EvidenceRef } from './types'

/**
 * Evidence collector — PURE.
 *
 * Tools push what they actually returned; the model never writes here, so it
 * cannot manufacture a citation. The validator later checks every claim's cited
 * refIds against this collector and drops what is not traceable.
 *
 * One collector per investigation — never shared, never global.
 */
export type EvidenceCollector = {
  add(ref: EvidenceRef): void
  all(): EvidenceRef[]
  has(kind: EvidenceEntityKind, refId: string): boolean
  hasMetric(metric: string): boolean
  size(): number
}

/**
 * Dedup identity. An entity is its kind + id. A metric is its name + window +
 * the entity it was measured on — NOT its sample size, so re-measuring the same
 * window does not create a second piece of evidence, while the same metric over
 * a different window does.
 *
 * `measuredOn` is part of the identity because the same metric name over the same
 * window measured on two different leads is two different measurements. Keying
 * without it would collapse them into one record, and the survivor would carry
 * the wrong subject — handing a claim a trace back to a lead it was never
 * measured on.
 */
function keyOf(ref: EvidenceRef): string {
  if (ref.kind !== 'metric') return `${ref.kind}:${ref.refId}`
  const on = ref.measuredOn ? `${ref.measuredOn.kind}:${ref.measuredOn.refId}` : ''
  return `metric:${ref.metric}:${ref.window.from}:${ref.window.to}:${on}`
}

export function createEvidenceCollector(): EvidenceCollector {
  const byKey = new Map<string, EvidenceRef>()

  return {
    add(ref) {
      byKey.set(keyOf(ref), ref)
    },

    all: () => [...byKey.values()],

    has: (kind, refId) => byKey.has(`${kind}:${refId}`),

    hasMetric(metric) {
      for (const ref of byKey.values()) {
        if (ref.kind === 'metric' && ref.metric === metric) return true
      }
      return false
    },

    size: () => byKey.size,
  }
}
