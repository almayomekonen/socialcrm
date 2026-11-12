/**
 * Conversational auto-response (IRE) rollout gate.
 *
 * With this ON for an agency, the qualify-mode agent stops treating every
 * message as a sales lead: the same model call that writes the reply also reads
 * the conversation's mode (personal, prospect, existing customer, support…), a
 * friend gets a natural reply instead of a business one, existing customers
 * (lead status 'closed') are answered instead of skipped, and the owner's
 * structured agent profile (greeting, persona, tone, FAQ, escalation topics) is
 * supplied to the model. See lib/inbox/autoresponse/conversational/.
 *
 * AUDIENCE. `IRE_CONVERSATIONAL_AGENCY_IDS` is either:
 *   - `all` (trimmed, any case): every agency, current and future. This is a
 *     rollout decision, not an eligibility decision: an agency still gets the
 *     conversational agent only where it would get the qualify agent at all
 *     (responder = AI agent, mode = 'qualify', auto response on, WhatsApp
 *     connected, plan entitlement, AI permission, kill switch, send gates);
 *   - an explicit comma list of agency ids (digits only; anything else in the
 *     list is ignored), as before.
 * Unset, empty or unparseable means NO agency. `*` is not accepted, and `all`
 * mixed into a list (`all,103`) is not `all`: only the exact value opens it to
 * everyone. Read per call, never cached at module scope.
 *
 * It never weakens a gate: the manual personal mark, opt-out, human takeover,
 * the 24-hour window, quiet hours, the daily cap, the kill switch, plan
 * entitlement and the send-time checks are evaluated exactly as without it.
 */
export function conversationalAgentAgencyIds(raw = process.env.IRE_CONVERSATIONAL_AGENCY_IDS): Set<number> {
  const ids = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0)
  return new Set(ids)
}

export type ConversationalAudience = 'all' | Set<number>

/** Who the conversational agent is rolled out to: everyone (`all`) or the listed agency ids. */
export function conversationalAgentAudience(raw = process.env.IRE_CONVERSATIONAL_AGENCY_IDS): ConversationalAudience {
  if ((raw ?? '').trim().toLowerCase() === 'all') return 'all'
  return conversationalAgentAgencyIds(raw)
}

/**
 * THE rollout decision, used by every surface: the WhatsApp worker
 * (conversational/hooks.ts startConversationalTurn), the owner's simulator
 * (the same function, through simulate/simulateTurn.ts), the preview action,
 * the settings page and the settings save. Eligibility is never decided here.
 */
export function canUseConversationalAgent(agencyId: number | null | undefined, raw = process.env.IRE_CONVERSATIONAL_AGENCY_IDS): boolean {
  if (!agencyId || !Number.isSafeInteger(agencyId) || agencyId <= 0) return false
  const audience = conversationalAgentAudience(raw)
  return audience === 'all' || audience.has(agencyId)
}
