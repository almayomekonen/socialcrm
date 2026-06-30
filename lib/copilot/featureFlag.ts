import 'server-only'
import { getAiEnv } from '@/lib/ai/env'

export function isCopilotEnabledForUser(user: { agencyId?: number | null } | null | undefined): boolean {
  if (!user || typeof user.agencyId !== 'number') return false
  const env = getAiEnv()
  if (!env.copilotEnabled) return false
  if (env.copilotAgencyAllowlist === 'all') return true
  return env.copilotAgencyAllowlist.includes(user.agencyId)
}

/**
 * Gate for the Reasoned General Mode (the executive Reasoner path). Requires the
 * copilot enabled for the user AND the agency opted in. Empty allowlist by
 * default → OFF, so the existing deterministic path is byte-for-byte unchanged.
 */
export function isReasonedGeneralEnabledForUser(user: { agencyId?: number | null } | null | undefined): boolean {
  if (!isCopilotEnabledForUser(user)) return false
  const list = getAiEnv().reasonedGeneralAgencyAllowlist
  if (list === 'all') return true
  return typeof user?.agencyId === 'number' && list.includes(user.agencyId)
}

/**
 * Gate for Executive Synthesis. Requires the copilot enabled for the user AND
 * the agency opted in via SYNTHESIS_AGENCY_IDS. Empty allowlist by default →
 * OFF, so the capability stays completely unreachable and product behavior is
 * byte-identical.
 */
export function isSynthesisEnabledForUser(user: { agencyId?: number | null } | null | undefined): boolean {
  if (!isCopilotEnabledForUser(user)) return false
  const list = getAiEnv().synthesisAgencyAllowlist
  if (list === 'all') return true
  return typeof user?.agencyId === 'number' && list.includes(user.agencyId)
}
