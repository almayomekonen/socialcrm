import { approvalRequiredFor, getAgentAction, type AgentActionDefinition } from './registry'
import type { ActionIntent } from './intent'
import type { ActionActor, ActionProposal, RiskLevel } from './types'

/**
 * The policy gate — where the application decides, having let the model ask.
 *
 * THE MODEL IS NOT THE SECURITY BOUNDARY. Everything a model produces reaches
 * this function as untrusted input: the action type, the arguments, and — most
 * importantly — any identity fields it tried to include. The gate answers three
 * questions in order, and a failure at any of them stops the action before an
 * idempotency claim is taken, so a refused action leaves no partial state.
 *
 *   1. Is this a real action?     → registry lookup, closed set
 *   2. Is the scope authentic?    → the authenticated agency must equal the one on
 *                                   the proposal, and the actor must be inside it
 *   3. Is the actor allowed?      → role against the action's risk class
 *
 * WHY THE AGENCY CHECK LOOKS REDUNDANT. `parseActionProposal` already stamps the
 * agency from the authenticated scope rather than reading one from the model, so
 * a mismatch here should be impossible. It is checked anyway because "impossible"
 * is a property of today's call sites, and a future one — a queue, a worker, a
 * replayed audit row — could hand over a proposal assembled somewhere else. This
 * is the layer that must not depend on its callers being careful.
 */

export type PolicyDenial =
  | { allowed: false; status: 'INVALID_ACTION'; reason: string }
  | { allowed: false; status: 'NOT_AUTHORIZED'; reason: string }

export type PolicyVerdict =
  | { allowed: true; definition: AgentActionDefinition; risk: RiskLevel; approvalRequired: boolean }
  | PolicyDenial

/**
 * Roles permitted to act at each risk level.
 *
 * ADMIN-ONLY ABOVE LOW RISK is the deliberately conservative starting point.
 * Widening it later is a one-line change reviewed on its own merits; starting
 * wide and narrowing after an incident is not a trade this system should make.
 */
const ROLE_CEILING: Record<RiskLevel, (role: string) => boolean> = {
  READ: () => true,
  LOW_RISK_WRITE: () => true,
  APPROVAL_REQUIRED: (role) => role === 'ADMIN' || role === 'MNGR',
  HIGH_RISK: (role) => role === 'ADMIN',
}

function actorIsCoherent(actor: ActionActor | undefined, agencyId: number): boolean {
  if (!actor) return false
  if (!Number.isInteger(actor.userId) || actor.userId <= 0) return false
  if (!Number.isInteger(actor.agencyId) || actor.agencyId <= 0) return false
  if (typeof actor.role !== 'string' || actor.role === '') return false
  return actor.agencyId === agencyId
}

export function evaluatePolicy(
  proposal: ActionProposal,
  /** The authenticated scope. This wins over anything on the proposal. */
  authenticated: ActionActor,
  /**
   * Derived by the application from the USER'S message — never from the
   * proposal, which has no field for it. See ./intent.
   */
  intent: ActionIntent,
): PolicyVerdict {
  const definition = getAgentAction(proposal.actionType)
  if (!definition) {
    // Includes every type the model could invent, and — during this phase —
    // every type at all, because the registry is deliberately empty.
    return { allowed: false, status: 'INVALID_ACTION', reason: 'unknown-action-type' }
  }

  if (!actorIsCoherent(proposal.actor, proposal.agencyId)) {
    return { allowed: false, status: 'NOT_AUTHORIZED', reason: 'incoherent-actor' }
  }

  // THE TENANT CHECK. A proposal that names any agency other than the
  // authenticated one is refused outright rather than quietly corrected: a
  // silent rewrite would hide the fact that something tried.
  if (proposal.agencyId !== authenticated.agencyId) {
    return { allowed: false, status: 'NOT_AUTHORIZED', reason: 'agency-scope-mismatch' }
  }
  if (proposal.actor.userId !== authenticated.userId) {
    return { allowed: false, status: 'NOT_AUTHORIZED', reason: 'actor-mismatch' }
  }

  if (!ROLE_CEILING[definition.risk](authenticated.role)) {
    return { allowed: false, status: 'NOT_AUTHORIZED', reason: 'role-below-risk-ceiling' }
  }

  return {
    allowed: true,
    definition,
    risk: definition.risk,
    approvalRequired: approvalRequiredFor(definition, intent),
  }
}
