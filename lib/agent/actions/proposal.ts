import { z } from 'zod'
import { deriveIdempotencyKey, hashArgs, canonicalize } from './idempotency'
import type { ActionActor, ActionProposal, RiskLevel } from './types'

/**
 * The boundary between what a model said and what the application will consider.
 *
 * THE SHAPE THE MODEL IS ALLOWED TO PRODUCE deliberately contains no identity at
 * all. There is no `agencyId` field, no `userId`, no `role`, no risk level and no
 * approval flag — not because a model would not fill them in honestly, but
 * because a field that does not exist in the schema cannot be honoured, forged,
 * or accidentally trusted by a future call site. Zod strips unknown keys, so a
 * payload that includes `agencyId: 999` loses it here, silently and completely,
 * before any code reads it.
 *
 * IDENTITY IS STAMPED, NOT COPIED. `agencyId`, `actor` and `agentRunId` come
 * from the server-resolved scope the investigation is already running under —
 * the same `AgentScope` every read tool closes over. The policy gate then
 * re-checks them, so the guarantee does not rest on this function alone.
 *
 * RISK IS NOT NEGOTIABLE EITHER. It comes from the registry entry for the action
 * type, never from the proposal, so a model cannot mark its own request low-risk.
 * This function does not even look it up; it leaves `risk` to the runtime, which
 * reads it from the definition the policy gate resolved.
 */

/** Exactly what a model may emit. Everything else is the application's. */
export const actionProposalSchema = z.object({
  actionType: z.string().min(1).max(64),
  args: z.record(z.string(), z.unknown()),
  /** Refs from the investigation's EvidenceCollector — `lead:161`, `health.gone_cold`. */
  evidenceRefs: z.array(z.string()).default([]),
  /** What the model believes will be true afterwards. The verifier decides. */
  expectedPostcondition: z.record(z.string(), z.unknown()).default({}),
})

export type ModelActionProposal = z.infer<typeof actionProposalSchema>

export type ParseFailure = { ok: false; reason: string }
export type ParseSuccess = { ok: true; proposal: ActionProposal }

export type ProposalIdentity = {
  agentRunId: string
  actor: ActionActor
  /** Minted by the application, once, per proposal. */
  actionId: string
  planId?: string | null
  /** Cross-run deduplication, when the caller genuinely wants it. */
  idempotencyKey?: string
  /** Filled by the runtime from the registry; this is only the placeholder. */
  risk?: RiskLevel
}

/**
 * Parse one model-shaped proposal into something the runtime will consider.
 *
 * Returns a failure rather than throwing: a malformed proposal is an ordinary
 * outcome to be audited and reported, not an exception that unwinds an
 * investigation which may have other, valid actions in the same plan.
 */
export function parseActionProposal(raw: unknown, identity: ProposalIdentity): ParseFailure | ParseSuccess {
  const parsed = actionProposalSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: 'malformed-proposal' }

  if (!identity.actor || !Number.isInteger(identity.actor.agencyId) || identity.actor.agencyId <= 0) {
    return { ok: false, reason: 'missing-actor' }
  }
  if (!Number.isInteger(identity.actor.userId) || identity.actor.userId <= 0) {
    return { ok: false, reason: 'missing-actor' }
  }
  if (!identity.agentRunId || !identity.actionId) return { ok: false, reason: 'missing-run-identity' }

  const args = canonicalize(parsed.data.args) as Record<string, unknown>
  const agencyId = identity.actor.agencyId
  const argsHash = hashArgs(args)

  return {
    ok: true,
    proposal: {
      actionId: identity.actionId,
      agentRunId: identity.agentRunId,
      // Authenticated scope, always. Never a value that travelled with the payload.
      agencyId,
      actor: identity.actor,
      actionType: parsed.data.actionType,
      args,
      argsHash,
      evidenceRefs: parsed.data.evidenceRefs,
      // A placeholder the policy gate overwrites from the registry definition.
      // It is never read before that happens.
      risk: identity.risk ?? 'HIGH_RISK',
      approvalRequired: true,
      idempotencyKey:
        identity.idempotencyKey ??
        deriveIdempotencyKey({ agencyId, actionType: parsed.data.actionType, args, agentRunId: identity.agentRunId }),
      expectedPostcondition: parsed.data.expectedPostcondition,
      planId: identity.planId ?? null,
    },
  }
}
