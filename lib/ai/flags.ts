import { getAiEnv } from './env'

export function isAiEnabled(): boolean {
  return getAiEnv().enabled
}

export function isAgencyAllowlisted(agencyId: number | null | undefined): boolean {
  if (!agencyId) return false
  const list = getAiEnv().agencyAllowlist
  if (list === 'all') return true
  return list.includes(agencyId)
}

export function hasAnyProviderConfigured(): boolean {
  const env = getAiEnv()
  return Boolean(env.anthropic || env.google || env.openai)
}

export function isCopilotPersistenceEnabled(): boolean {
  return getAiEnv().copilotPersistenceEnabled
}

/**
 * Phase 1.5 inspector kill-switch. Layered on top of the ADMIN role check at
 * the layout level. Default false — the inspector 404s on any deployment that
 * hasn't explicitly opted in. The surface exposes provider/model identifiers
 * so it must never reach a customer-facing deployment.
 */
export function isCopilotInspectorEnabled(): boolean {
  return getAiEnv().copilotInspectorEnabled
}

/**
 * General Mode (no-lead copilot) rollout gate. Defaults OFF: with no agency on
 * the `GENERAL_MODE_AGENCY_IDS` allowlist, this returns false everywhere, so the
 * panel keeps today's exact behaviour. Mirrors `isAgencyAllowlisted`.
 */
export function isGeneralModeEnabled(agencyId: number | null | undefined): boolean {
  if (!isAiEnabled()) return false
  if (!agencyId) return false
  const list = getAiEnv().generalModeAgencyAllowlist
  if (list === 'all') return true
  return list.includes(agencyId)
}

/**
 * CRM Agent rollout gate. Defaults OFF: with no agency on `AGENT_AGENCY_IDS`
 * this returns false everywhere, so the Agent route 404s until an agency is
 * explicitly opted in.
 *
 * This is a ROLLOUT gate, not an authorization one. It sits ON TOP of the global
 * AI admission sequence — `admitAiRun` still runs inside every investigation and
 * still owns AI_ENABLED, the agency allowlist, entitlement, providers and the
 * spend cap. Nothing here replaces or duplicates any of that; it only decides
 * whether this particular surface is switched on for an agency yet.
 *
 * Mirrors `isGeneralModeEnabled`, including its `isAiEnabled()` short-circuit, so
 * turning AI off turns the Agent off with it.
 */
export function isAgentEnabled(agencyId: number | null | undefined): boolean {
  if (!isAiEnabled()) return false
  if (!agencyId) return false
  const list = getAiEnv().agentAgencyAllowlist
  if (list === 'all') return true
  return list.includes(agencyId)
}
