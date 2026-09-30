import { resolveAiAccess } from '@/lib/ai/access'
import { canUseAgentReliability } from '@/lib/flags/agentReliabilityFlags'

/**
 * Automatic replies that need the AI entitlement, and what happens without it.
 *
 * Before this, an agency whose trial had ended still got an AI job for every
 * inbound message. The router refused it at admission (`subscription-required`,
 * no provider called), the worker read that as `ai_unavailable`, retried, and
 * dead-lettered it. The customer received nothing and nobody was told —
 * production, agency 149, every first reply from 2026-09-22.
 *
 * Now, for agencies in the rollout, no such job is created (enqueue) and none is
 * run (worker, for anything already queued). No substitute message is sent: a
 * fixed "thanks, we'll be in touch" in place of the paid agent would tell the
 * customer something is answering when the plan does not include it. The
 * inbound message itself is untouched — persisted, notified, visible — and the
 * inbox thread says the automatic reply is paused (AgentOwnership).
 *
 * The entitlement rule is NOT decided here. `resolveAiAccess` is the single
 * source (and fails open on read errors, so a transient failure never pauses a
 * paying customer).
 */

export type ReplySettingsShape = {
  responder?: string | null
  mode?: string | null
  replyMode?: string | null
}

/**
 * Does this agency's configured automatic reply call a model? The deterministic
 * questionnaire never does, and neither does a fixed reply the owner wrote.
 */
export function automaticReplyNeedsAi(settings: ReplySettingsShape | null | undefined): boolean {
  if (!settings) return false
  if (settings.responder === 'questionnaire') return false
  if (settings.mode === 'qualify') return true
  return settings.replyMode !== 'fixed'
}

/**
 * True when the automatic reply is configured to use AI and this agency's plan
 * does not include it. Only evaluated for agencies in the rollout.
 */
export async function aiRepliesPausedForPlan(
  agencyId: number,
  settings: ReplySettingsShape | null | undefined,
): Promise<boolean> {
  if (!canUseAgentReliability(agencyId)) return false
  if (!automaticReplyNeedsAi(settings)) return false
  const access = await resolveAiAccess(agencyId)
  return access.allowed === false
}
