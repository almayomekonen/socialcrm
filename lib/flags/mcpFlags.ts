/**
 * ChatGPT / MCP rollout gate.
 *
 * MCP_* prefix discipline, mirroring MOBILE_* / NOTIFICATIONS_* / AUTOMATIONS_*;
 * never reusing another subsystem's env var.
 *
 * FAIL CLOSED. Only the exact string '1' enables MCP. 'true', ' 1', 'yes' and an
 * absent value all mean OFF, and OFF means every MCP and OAuth endpoint answers
 * 404 — the default state of every environment that has never heard of this.
 *
 * TWO DELIBERATE STEPS to reach a real user: the master switch AND a named
 * agency. An empty allowlist means NO agency, so flipping the master switch
 * alone exposes the integration to nobody.
 *
 * Read per call, never cached at module scope: a kill switch you have to
 * redeploy to use is not a kill switch.
 */

export function isMcpEnabled(): boolean {
  return process.env.MCP_ENABLED === '1'
}

function parseAllowlist(raw: string | undefined): 'all' | Set<number> {
  const v = raw?.trim() ?? ''
  if (v === 'all') return 'all'
  const ids = v
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0)
  return new Set(ids)
}

/** Canary by agency id — the same allowlist shape as the mobile/notifications gates. */
export function isMcpAgencyAllowlisted(agencyId: number): boolean {
  const list = parseAllowlist(process.env.MCP_AGENCY_ALLOWLIST)
  return list === 'all' ? true : list.has(agencyId)
}

/** The single question every MCP/OAuth surface asks: "may this agency use ChatGPT?" */
export function canUseMcp(agencyId: number | null | undefined): boolean {
  if (!agencyId) return false
  return isMcpEnabled() && isMcpAgencyAllowlisted(agencyId)
}
