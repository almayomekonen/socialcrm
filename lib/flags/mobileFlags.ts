/**
 * Mobile workspace rollout gate.
 *
 * MOBILE_* prefix discipline, mirroring NOTIFICATIONS_* and AUTOMATIONS_*; never
 * reusing another subsystem's env var.
 *
 * ABSENCE BLOCKS. `MOBILE_WORKSPACE_ENABLED !== '1'` means OFF, so the default
 * state of every machine that has never heard of this feature — production and
 * every preview environment right now — is the CURRENT behaviour: phones keep
 * being redirected to `/activate`. Shipping this file changes nothing anywhere.
 *
 * TWO DELIBERATE STEPS to reach a real user: the master switch AND a named
 * agency. An empty allowlist means NO agency, so flipping the master switch
 * alone still exposes the mobile workspace to nobody. This is what makes the
 * Phase 10 "5–10 real users" beta possible without a code change.
 *
 * Read per call, never cached at module scope: a kill switch you have to
 * redeploy to use is not a kill switch.
 */

export function isMobileWorkspaceEnabled(): boolean {
  return process.env.MOBILE_WORKSPACE_ENABLED === '1'
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

/** Canary by agency id — the notifications / whatsapp-templates allowlist pattern. */
export function isMobileWorkspaceAgencyAllowlisted(agencyId: number): boolean {
  const list = parseAllowlist(process.env.MOBILE_WORKSPACE_AGENCY_ALLOWLIST)
  return list === 'all' ? true : list.has(agencyId)
}

/**
 * The single question the layout will ask in Phase 2:
 * "may this agency's phones enter the real product instead of /activate?"
 *
 * Both gates must pass. Kept here rather than inlined at the call site so the
 * redirect decision has exactly one definition — the mistake that produced the
 * viewport-vs-User-Agent mismatch documented in the funnel audit was two places
 * deciding "is this mobile" by different rules.
 *
 * NOT YET CONSULTED. Phase 1 ships the gate; Phase 2 wires it into
 * `app/(app)/layout.tsx` once Today has a mobile presentation to land on.
 */
export function canEnterMobileWorkspace(agencyId: number | null | undefined): boolean {
  if (!agencyId) return false
  return isMobileWorkspaceEnabled() && isMobileWorkspaceAgencyAllowlisted(agencyId)
}
