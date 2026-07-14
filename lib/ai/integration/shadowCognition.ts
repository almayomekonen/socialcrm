import { interpret as defaultInterpret, type ExternalSignal } from '@/lib/ai/runtime/eventInterpretation'
import { RuntimeScheduler } from '@/lib/ai/runtime/scheduler'
import { reason as defaultReason } from '@/lib/ai/runtime/reasoning'
import { decide as defaultDecide } from '@/lib/ai/runtime/toolAction'
import { recordShadowDecision as defaultRecord } from '@/db/ai/shadowDecisions'
import type { Scope } from '@/db/ai/stateManagement'

/**
 * Integration-2 — Shadow Cognition (read-path shadow validation).
 *
 * After Integration-1 has written this turn's shadow beliefs, this module runs
 * the runtime's read spine in shadow — Event Interpretation (M3, the trigger) →
 * Runtime Scheduler (M4, event admission) → Reasoning Runtime (M5) → Tool/Action
 * Runtime (M6) — and persists the resulting GateDecision to the isolated
 * `ai_shadow_decisions` sink for offline comparison against legacy conversation
 * intelligence. It is read-only: it takes no action, sends nothing, and crosses
 * no boundary; it only records what the runtime *would* conclude.
 *
 * Safe by construction, identically to Integration-1:
 *   • Its own feature flag, default OFF (empty allowlist → no-op everywhere).
 *     SHADOW_COGNITION_KILL=1 is the global backstop. Independent of the ingest
 *     flag, so cognition can be killed while ingestion continues.
 *   • Fully guarded: never throws and returns nothing the caller must handle — a
 *     shadow failure can never affect the qualification worker.
 *   • Reversible: clear the allowlist / set KILL / truncate the isolated table.
 *
 * It exercises only M4's event-admission path (`admit`), not the Tier-1 coverage
 * sweep (that is a later, decoupled integration). It uses M3/M4/M5/M6 through
 * their public contracts only — no runtime module is modified.
 */

export interface ShadowCognitionInput {
  agencyId: number
  leadId: number | string
  conversationId: number
  turnCount: number
  occurredAt?: Date
}

export interface ShadowCognitionDeps {
  isEnabled?: (agencyId: number) => boolean
  interpret?: typeof defaultInterpret
  reason?: typeof defaultReason
  decide?: typeof defaultDecide
  record?: typeof defaultRecord
}

export interface ShadowCognitionResult {
  /** True when the flag is off for this agency — a pure no-op. */
  skipped: boolean
  /** True when the read spine ran to a decision. */
  ran: boolean
  outcome: 'recommend' | 'stay_silent' | 'rejected' | null
  persisted: boolean
  errored: boolean
}

/**
 * Per-agency canary flag, default OFF. Empty/unset allowlist → off everywhere.
 * `SHADOW_COGNITION_KILL=1` is the global backstop. Independent of ingest.
 */
export function isShadowCognitionEnabled(agencyId: number | null | undefined): boolean {
  const kill = process.env.SHADOW_COGNITION_KILL
  if (kill === '1' || kill === 'true') return false
  const raw = (process.env.SHADOW_COGNITION_AGENCY_IDS ?? '').trim()
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
 * Run shadow cognition for one lead and persist the shadow decision. Guarded and
 * flag-gated: safe to call unconditionally from the production worker. Never throws.
 */
export async function shadowReasonAndDecide(
  input: ShadowCognitionInput,
  deps: ShadowCognitionDeps = {},
): Promise<ShadowCognitionResult> {
  const result: ShadowCognitionResult = { skipped: true, ran: false, outcome: null, persisted: false, errored: false }
  const isEnabled = deps.isEnabled ?? isShadowCognitionEnabled
  if (!isEnabled(input.agencyId)) return result
  result.skipped = false

  const interpret = deps.interpret ?? defaultInterpret
  const reason = deps.reason ?? defaultReason
  const decide = deps.decide ?? defaultDecide
  const record = deps.record ?? defaultRecord
  const scope: Scope = { agencyId: input.agencyId }
  const subjectId = String(input.leadId)
  const now = input.occurredAt ?? new Date()

  try {
    // M3 — interpret the inbound trigger (the qualification turn) into a runtime event.
    const signal: ExternalSignal = {
      signalType: 'message',
      scope,
      source: { kind: 'counterpart' },
      occurredAt: now,
      subject: { subjectType: 'lead', subjectId },
      traceRefs: [{ type: 'conversation', id: String(input.conversationId) }],
      inferentialDistance: 'medium',
    }
    const interpreted = interpret(signal)
    if (!interpreted.accepted || interpreted.event.kind !== 'inbound_trace') return result

    // M4 — event admission yields the cognition request (Tier-2 inbound). Ephemeral
    // instance: only the event-admission contract is used, never coverage residency.
    const requests = new RuntimeScheduler(scope).admit(interpreted.event, { now })
    const request = requests[0]
    if (!request) return result

    // M5 — reason over the resident World Model (now holding this turn's beliefs).
    const understanding = await reason(request, { now })

    // M6 — gate to a terminal shadow outcome. Read-only: nothing is acted on.
    const decision = decide(understanding, { scope, now })
    result.ran = true

    const outcome: ShadowCognitionResult['outcome'] = decision.emitted ? decision.outcome : 'rejected'
    result.outcome = outcome

    await record({
      agencyId: input.agencyId,
      subjectType: 'lead',
      subjectId,
      conversationId: input.conversationId,
      turnCount: input.turnCount,
      outcome,
      emitted: decision.emitted,
      rejectionBoundary: 'rejection' in decision ? decision.rejection.boundary : null,
      decision,
      runtimeAsOf: understanding.asOf,
    })
    result.persisted = true
  } catch (err) {
    // A guarded backstop: shadow cognition must never affect the production path.
    result.errored = true
    console.error(`[shadow-cognition] conv=${input.conversationId} agency=${input.agencyId}:`, (err as Error).message)
  }
  return result
}
