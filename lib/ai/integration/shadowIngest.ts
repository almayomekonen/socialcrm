import { interpret as defaultInterpret, type ExternalSignal } from '@/lib/ai/runtime/eventInterpretation'
import { applyRelationshipBelief as defaultApplyRelationshipBelief } from '@/lib/ai/runtime/worldModel'
import type { Scope } from '@/db/ai/stateManagement'
import type { Qualification } from '@/lib/inbox/autoresponse/qualification'

/**
 * Integration-1 — Shadow ingestion of production qualification signals.
 *
 * This is the first production integration seam. It does NOT change any
 * production behaviour: legacy `conversationAiState` (recordTurn/mergeOnly)
 * remains the sole source of truth. In parallel, and only for allowlisted canary
 * agencies, the SAME extracted `Qualification` is fed through the ratified runtime
 * — Event Interpretation (M3, the ingress seam) → World Model Runtime (M2 write
 * surface) → State Management (M1) — so the resident, agency-scoped World Model
 * begins to fill from real production signals. Nothing reads these shadow beliefs
 * yet; they are the shadow source of truth.
 *
 * Hard guarantees for a safe canary:
 *   • Feature-flagged, default OFF. With no agency allowlisted it is a no-op
 *     everywhere (one flag check, no I/O), so production is byte-for-byte unchanged.
 *   • Fully guarded: it never throws and never returns anything the caller must
 *     handle — a shadow failure can never affect the qualification worker.
 *   • Reversible: `SHADOW_INGEST_KILL=1` halts it globally; clearing the allowlist
 *     turns it off; the shadow `ai_*` rows are isolated and can be truncated.
 *
 * The Qualification→Belief mapping here is integration glue, not runtime logic:
 * each extracted field becomes one moderate-confidence, medium-inferential-distance
 * belief keyed `qualification.<field>`, its provenance walking back to the
 * conversation. The runtime's ingress seam still applies — a field that cannot be
 * grounded to a trace is rejected at M3 and never written.
 */

export interface ShadowIngestDeps {
  isEnabled?: (agencyId: number) => boolean
  interpret?: typeof defaultInterpret
  applyBelief?: typeof defaultApplyRelationshipBelief
}

export interface ShadowIngestInput {
  agencyId: number
  leadId: number | string
  conversationId: number
  extracted: Qualification
  occurredAt?: Date
}

export interface ShadowIngestResult {
  /** True when the flag is off for this agency — a pure no-op. */
  skipped: boolean
  ingested: number
  rejected: number
  errored: number
}

/** Conservative integration-glue defaults for a shadow (inferred-from-message) belief. */
const SHADOW_CONFIDENCE = 0.6
const SHADOW_GROUNDEDNESS = 0.5

/**
 * Per-agency canary flag, default OFF. Empty/unset allowlist → off everywhere, so
 * production is unchanged. `SHADOW_INGEST_KILL=1` is the global backstop.
 */
export function isShadowIngestEnabled(agencyId: number | null | undefined): boolean {
  const kill = process.env.SHADOW_INGEST_KILL
  if (kill === '1' || kill === 'true') return false
  const raw = (process.env.SHADOW_INGEST_AGENCY_IDS ?? '').trim()
  if (!raw) return false
  if (raw === 'all') return true
  if (!agencyId) return false
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .includes(agencyId)
}

/**
 * Feed one turn's extracted qualification into the runtime as shadow beliefs.
 * Guarded and flag-gated: safe to call unconditionally from the production worker.
 * Never throws.
 */
export async function shadowIngestQualification(
  input: ShadowIngestInput,
  deps: ShadowIngestDeps = {},
): Promise<ShadowIngestResult> {
  const result: ShadowIngestResult = { skipped: true, ingested: 0, rejected: 0, errored: 0 }
  const isEnabled = deps.isEnabled ?? isShadowIngestEnabled
  if (!isEnabled(input.agencyId)) return result
  result.skipped = false

  const interpret = deps.interpret ?? defaultInterpret
  const applyBelief = deps.applyBelief ?? defaultApplyRelationshipBelief
  const scope: Scope = { agencyId: input.agencyId }
  const subjectId = String(input.leadId)
  const occurredAt = input.occurredAt ?? new Date()

  try {
    for (const [field, rawValue] of Object.entries(input.extracted)) {
      const value = typeof rawValue === 'string' ? rawValue.trim() : ''
      if (!value) continue

      try {
        const signal: ExternalSignal = {
          signalType: 'message',
          scope,
          source: { kind: 'inferred', id: 'qualifier-v1' },
          occurredAt,
          subject: { subjectType: 'lead', subjectId },
          traceRefs: [{ type: 'conversation', id: String(input.conversationId) }],
          inferentialDistance: 'medium',
          payload: { field, value },
        }
        const interpreted = interpret(signal)
        if (!interpreted.accepted || interpreted.event.kind !== 'inbound_trace') {
          result.rejected += 1
          continue
        }
        const sig = interpreted.event.signal
        await applyBelief(
          scope,
          subjectId,
          {
            key: `qualification.${field}`,
            content: { value },
            confidence: SHADOW_CONFIDENCE,
            groundedness: SHADOW_GROUNDEDNESS,
            uncertaintyKind: 'epistemic',
            evidenceFor: sig.provenance.traceRefs,
            provenance: { traceRefs: sig.provenance.traceRefs, inferentialDistance: sig.provenance.inferentialDistance },
            isAbsenceDerived: false,
            freshnessAt: occurredAt,
          },
          { now: occurredAt },
        )
        result.ingested += 1
      } catch (fieldErr) {
        result.errored += 1
        console.error(`[shadow-ingest] field '${field}' conv=${input.conversationId}:`, (fieldErr as Error).message)
      }
    }
  } catch (err) {
    // A guarded backstop: shadow ingestion must never affect the production path.
    console.error(`[shadow-ingest] conv=${input.conversationId} agency=${input.agencyId}:`, (err as Error).message)
  }
  return result
}
