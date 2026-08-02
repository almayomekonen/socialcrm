/**
 * Customer Automation Engine gates (AUTOMATIONS_* prefix discipline, spec §0
 * — never the platform's EMAIL_ENABLED/RESEND_* envs).
 *
 * Kill switch: AUTOMATIONS_ENABLED !== '1' ⇒ the engine is OFF (the default —
 * absence blocks). Allowlist: AUTOMATIONS_AGENCY_ALLOWLIST is 'all' or a CSV
 * of agency ids; empty ⇒ no agency (the whatsapp templates flag pattern).
 */

export function isAutomationsEnabled(): boolean {
  return process.env.AUTOMATIONS_ENABLED === '1'
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

export function isAutomationsAgencyAllowlisted(agencyId: number): boolean {
  const list = parseAllowlist(process.env.AUTOMATIONS_AGENCY_ALLOWLIST)
  return list === 'all' ? true : list.has(agencyId)
}

export type AutomationsSendMode = 'log' | 'live'

/**
 * Effect gate (ADR-009/ADR-011): anything but the explicit literal 'live'
 * means log mode — the transport is unreachable. Default (unset) is 'log';
 * observation is the only executable path until Phase 7 flips this
 * deliberately. Re-read per worker pass — no restart needed.
 */
export function getAutomationsSendMode(): AutomationsSendMode {
  return process.env.AUTOMATIONS_SEND_MODE === 'live' ? 'live' : 'log'
}

/** Customer sending identity (ADR-002). Empty until infra resolves §12.2. */
export function getAutomationsFrom(): string {
  return process.env.AUTOMATIONS_FROM?.trim() ?? ''
}
