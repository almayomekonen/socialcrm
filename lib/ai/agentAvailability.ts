import 'server-only'
import { getAgencyProductAccess } from '@/lib/access/productAccess'
import { isAgentEnabled, isAiEnabled } from '@/lib/ai/flags'

/**
 * WHO MAY USE THE AGENT — one decision for every surface: the /agent page, the
 * app nav and Copilot, the mobile workspace, the agent / stream / transcribe
 * routes, the Action Runtime bridge and the WhatsApp assistant's identity.
 * Before this, each called `isAgentEnabled` on its own and only some of them
 * also asked about product access, so a surface could disagree with another.
 *
 * AGENT_AUDIENCE (absence = `list`, today's behaviour)
 *   list   the agency is in AGENT_AGENCY_IDS (`isAgentEnabled`, unchanged — a
 *          whole-value `all`/`*` there keeps its existing meaning; mixed tokens
 *          like `1,all` are ids only, as before)
 *   paid   every agency whose product access is PAID or LEGACY
 *   all    every agency with product access: PAID, LEGACY or an active trial
 *   anything else → nobody (fails closed, and says why)
 *
 * AGENT_EXCLUDED_AGENCY_IDS
 *   Explicit ids that never get the Agent, in every mode. Plain digits only:
 *   `all`, `*` and other tokens are ignored, so no value excludes "everyone"
 *   by accident and none is read as an id.
 *
 * Every mode also needs AI_ENABLED and product access (PAID, TRIAL_ACTIVE,
 * LEGACY — the layout's own rule, failing open on a read error exactly as the
 * layout and the AI gate do). Nothing here replaces a later guard: the AI gate
 * (allowlist, entitlement, providers, spend), resolveAgentScope, the WhatsApp
 * identity's fail-closed product check and every role rule still run.
 */

export type AgentAudience = 'list' | 'paid' | 'all'

export type AgentUnavailableReason =
  | 'no_agency'
  | 'ai_disabled'
  | 'invalid_audience'
  | 'excluded'
  | 'not_in_audience'
  | 'no_product_access'

export type AgentAvailability =
  | { available: true; audience: AgentAudience }
  | { available: false; reason: AgentUnavailableReason; audience: AgentAudience | null }

/** The configured audience; `null` for a value that is not one of the three. */
export function agentAudience(): AgentAudience | null {
  const raw = process.env.AGENT_AUDIENCE?.trim()
  if (!raw) return 'list'
  return raw === 'list' || raw === 'paid' || raw === 'all' ? raw : null
}

export function agentExcludedAgencyIds(): number[] {
  const ids = (process.env.AGENT_EXCLUDED_AGENCY_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0)
  return [...new Set(ids)]
}

export async function getAgentAvailability(agencyId: number | null | undefined): Promise<AgentAvailability> {
  const audience = agentAudience()
  if (!agencyId || !Number.isSafeInteger(agencyId) || agencyId <= 0) return { available: false, reason: 'no_agency', audience }
  if (audience === null) {
    console.warn('[agent] AGENT_AUDIENCE has an unknown value; the Agent is off for everyone')
    return { available: false, reason: 'invalid_audience', audience }
  }
  if (agentExcludedAgencyIds().includes(agencyId)) return { available: false, reason: 'excluded', audience }
  // `list` is today's decision exactly: isAgentEnabled is AI_ENABLED and the id
  // list together, so in this mode either one missing reads as not_in_audience.
  if (audience === 'list') {
    if (!isAgentEnabled(agencyId)) return { available: false, reason: 'not_in_audience', audience }
  } else if (!isAiEnabled()) return { available: false, reason: 'ai_disabled', audience }

  const access = await getAgencyProductAccess(agencyId)
  if (!access.hasAccess) return { available: false, reason: 'no_product_access', audience }
  // `paid` leaves out an active trial. UNKNOWN is a failed read, which fails open everywhere else too.
  if (audience === 'paid' && access.status === 'TRIAL_ACTIVE') return { available: false, reason: 'not_in_audience', audience }
  return { available: true, audience }
}

export async function isAgentAvailable(agencyId: number | null | undefined): Promise<boolean> {
  return (await getAgentAvailability(agencyId)).available
}
