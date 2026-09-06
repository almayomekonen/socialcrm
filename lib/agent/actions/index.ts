/**
 * The Agent Action Runtime — public surface.
 *
 * The order below is the flow: a model proposal is parsed into something typed,
 * the policy gate decides whether it may run at all, an approval must name it
 * exactly, the store claims it durably, an executor performs it by calling an
 * existing CRM service, and a verifier re-reads the source of truth before
 * anything may be called done.
 *
 * There is no export here that mutates anything. Every mutation lives behind a
 * registry entry, and the registry is empty until domain actions are reviewed.
 */
export * from './types'
export { parseActionProposal, actionProposalSchema, type ModelActionProposal } from './proposal'
export {
  registerAgentAction, getAgentAction, registeredActionTypes,
  approvalRequiredFor, __resetAgentActionRegistry,
  type AgentActionDefinition, type ExecuteContext,
} from './registry'
export { evaluatePolicy, type PolicyVerdict } from './policy'
export { deriveActionIntent, ACTION_INTENTS, type ActionIntent, type IntentVerdict } from './intent'
export { requiresReconciliation, reconcileAction, type ReconciliationVerdict } from './reconcile'
export { evaluateApproval, type ApprovalVerdict } from './approval'
export { canonicalize, canonicalJson, hashArgs, deriveIdempotencyKey, decideOnExistingClaim } from './idempotency'
export { reportFor, baseRecord } from './outcome'
export { createInMemoryActionStore, type ActionStore, type ActionRecord } from './store'
export { createActionRuntime, type ActionRuntime, type ActionRuntimeContext } from './runtime'
