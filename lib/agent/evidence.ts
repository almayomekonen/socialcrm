import type { EvidenceEntityKind, EvidenceRef } from './types'

/**
 * The entity kinds a claim may cite. Metrics are cited by name, not by ref.
 *
 * `source` IS DELIBERATELY NOT HERE, and the omission is load-bearing rather
 * than tidy. Adding it would make `parseEntityRef` accept `source:src_1` as a
 * qualified entity ref, `resolvesAsEntity` would then find it, and a web page
 * would be one membership check away from grounding a FACT — and from there an
 * action, since both action gates ask `has('lead', id)`. External evidence has
 * its own accessor and its own resolver for exactly this reason.
 * Pinned by `__tests__/ai/agent/research/actionAuthorityBoundary.test.ts`.
 */
export const EVIDENCE_ENTITY_KINDS = ['lead', 'conversation', 'message'] as const

/**
 * The CANONICAL, model-facing form of an entity reference: `lead:161`.
 *
 * This exists because the model had to invent a citation syntax and invented a
 * reasonable one. Tools returned `leadId: 161`; the collector keyed evidence on
 * the bare `"161"`; the model cited `"lead:161"`. Nothing was wrong with any of
 * those three decisions in isolation, and together they meant that in a live
 * 21-question run every FACT and RECOMMENDATION naming a lead was destroyed as
 * `no-valid-evidence` — 40 claims — while OBSERVATIONs survived, because metrics
 * happen to be cited by a bare name that matches exactly.
 *
 * So the format stops being something to infer. Tools emit `evidenceRef` in this
 * form beside every id, the prompt states it, and {@link parseEntityRef} accepts
 * it. The bare id keeps resolving too — see the resolver in ./validate.
 */
export function entityRef(kind: EvidenceEntityKind, id: string | number): string {
  return `${kind}:${id}`
}

/**
 * Read a kind-qualified reference, or null if it is not one.
 *
 * STRICTNESS IS THE POINT, and it is why this does not simply split on the
 * colon and keep the tail. An unknown prefix returns null rather than its id, so
 * `customer:161` never becomes lead 161 — the caller then treats the whole
 * string as a bare id, which cannot match either. Kind stays meaningful: a
 * qualified ref resolves against THAT kind and no other.
 */
export function parseEntityRef(ref: string): { kind: EvidenceEntityKind; id: string } | null {
  const at = ref.indexOf(':')
  if (at <= 0) return null
  const kind = ref.slice(0, at)
  const id = ref.slice(at + 1)
  if (!id) return null
  if (!(EVIDENCE_ENTITY_KINDS as readonly string[]).includes(kind)) return null
  return { kind: kind as EvidenceEntityKind, id }
}

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
  /** Does this ref name a page the search actually consulted in THIS run? */
  hasSource(refId: string): boolean
  /** Harvested sources, in insertion order — for citation rendering and counts. */
  sources(): Extract<EvidenceRef, { kind: 'source' }>[]
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
  /**
   * A source is identified by its URL, not by its assigned refId. The provider
   * returns the same page more than once in a single run — measured: six source
   * entries over three distinct URLs — and two refIds pointing at one page would
   * let a claim look twice-supported by citing both.
   */
  if (ref.kind === 'source') return `source:${ref.url}`
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

    /**
     * Looked up by refId, while storage is keyed by URL — so this scans rather
     * than indexes. The set is capped at harvest (single digits), and the
     * alternative, a second index, is a second thing to keep in step.
     */
    hasSource(refId) {
      for (const ref of byKey.values()) {
        if (ref.kind === 'source' && ref.refId === refId) return true
      }
      return false
    },

    sources() {
      return [...byKey.values()].filter((r): r is Extract<EvidenceRef, { kind: 'source' }> => r.kind === 'source')
    },

    size: () => byKey.size,
  }
}
