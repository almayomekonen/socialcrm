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
 * ABSENCE BLOCKS. `IRE_CONVERSATIONAL_AGENCY_IDS` is an explicit comma list of
 * agency ids. Unset, empty or unparseable means NO agency, and "all" is not
 * accepted: this changes what real customers receive, so each agency is named
 * on purpose. Read per call, never cached at module scope.
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

export function canUseConversationalAgent(agencyId: number | null | undefined): boolean {
  if (!agencyId || !Number.isSafeInteger(agencyId) || agencyId <= 0) return false
  return conversationalAgentAgencyIds().has(agencyId)
}
