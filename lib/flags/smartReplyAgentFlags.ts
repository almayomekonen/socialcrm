/**
 * Conversational agent rollout gate for Smart Reply.
 *
 * ABSENCE BLOCKS. Wiring Smart Reply to the conversational agent is a real
 * behaviour change for every existing customer: today they receive exactly one
 * acknowledgement per conversation, and afterwards the agent keeps talking. That
 * change must be a decision someone makes per agency, not something that happens
 * because an owner opened the settings page and pressed Save.
 *
 * So the settings write only sets `mode: 'qualify'` for an allowlisted agency.
 * Everyone else keeps whatever mode their row already has, and saving other
 * settings leaves it untouched. Shipping this file changes nothing anywhere.
 *
 * TWO DELIBERATE STEPS, matching `whatsappContactsFlags`: the master switch AND
 * a named agency. An empty allowlist means NO agency.
 *
 * Read per call, never cached at module scope.
 */

export function isSmartReplyAgentEnabled(): boolean {
  return process.env.SMART_REPLY_AGENT_ENABLED === '1'
}

function parseAllowlist(raw: string | undefined): 'all' | Set<number> {
  const v = raw?.trim() ?? ''
  if (v === 'all') return 'all'
  const ids = v
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
  return new Set(ids)
}

export function isSmartReplyAgentAgencyAllowlisted(agencyId: number): boolean {
  const list = parseAllowlist(process.env.SMART_REPLY_AGENT_AGENCY_IDS)
  return list === 'all' ? true : list.has(agencyId)
}

export function canUseSmartReplyAgent(agencyId: number | null | undefined): boolean {
  if (!agencyId) return false
  if (!isSmartReplyAgentEnabled()) return false
  return isSmartReplyAgentAgencyAllowlisted(agencyId)
}
