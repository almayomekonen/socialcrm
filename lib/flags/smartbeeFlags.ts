/**
 * SmartBee document issuing — who may use it. Read per call, never cached.
 *
 * SMARTBEE_AGENCY_IDS: an explicit comma-separated list of agency ids. Digits
 * only: `all`, `*` or anything else is IGNORED, by design. This provider is
 * opened to a named agency, never to an audience. Absent or empty = off for
 * everyone.
 *
 * The allowlist only OFFERS the capability. Every operation still needs the
 * agency's active stored connection and its owner (lib/integrations/core/permissions.ts).
 *
 * SMARTBEE_PRODUCTION_ENABLED: exactly `1` lets a connection whose environment is
 * `production` operate. Absent = production connections are refused even if one
 * is stored. Sandbox only until the owner approves otherwise.
 */

function parseIds(raw: string | undefined): number[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0)
}

export function smartbeeAgencyIds(): number[] {
  return [...new Set(parseIds(process.env.SMARTBEE_AGENCY_IDS))]
}

export function isSmartbeeAgency(agencyId: number | null | undefined): boolean {
  if (!agencyId || !Number.isSafeInteger(agencyId) || agencyId <= 0) return false
  return smartbeeAgencyIds().includes(agencyId)
}

export function smartbeeProductionEnabled(): boolean {
  return process.env.SMARTBEE_PRODUCTION_ENABLED?.trim() === '1'
}
