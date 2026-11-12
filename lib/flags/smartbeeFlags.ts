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
 * PINNED IN CODE. SmartBee is exclusive to Talisman (agency 167) by owner order
 * (2026-11-12), permanently unless the owner explicitly authorises more.
 * SMARTBEE_PERMITTED_AGENCY_IDS is the ceiling: the env list can only NARROW it
 * (to nobody), never widen it. An agency outside the pin is refused even if the
 * env names it, so a mistyped or broadened env value cannot open SmartBee to
 * anyone else. Every server path goes through isSmartbeeAgency: the provider's
 * isAgencyAllowed (lib/integrations/core/permissions.ts resolveIntegrationAccess
 * for document create/resolve), the WhatsApp assistant route and worker, the
 * follow-up cron and the owner notices.
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

/** The only agencies SmartBee may ever serve. Expanding this requires the owner's explicit authorisation. */
export const SMARTBEE_PERMITTED_AGENCY_IDS: readonly number[] = Object.freeze([167])

let permitted: readonly number[] = SMARTBEE_PERMITTED_AGENCY_IDS

/**
 * Tests only: the database suites create their own agencies, whose ids are not
 * 167. Throws anywhere but under Vitest, so no deployed code path can widen the
 * pin. `null` restores it.
 */
export function _setSmartbeePermittedAgencyIdsForTests(ids: readonly number[] | null): void {
  if (process.env.VITEST !== 'true') throw new Error('SmartBee pin can only be changed in tests')
  permitted = ids ?? SMARTBEE_PERMITTED_AGENCY_IDS
}

/** The env list, intersected with the pin: never an agency outside SMARTBEE_PERMITTED_AGENCY_IDS. */
export function smartbeeAgencyIds(raw = process.env.SMARTBEE_AGENCY_IDS): number[] {
  return [...new Set(parseIds(raw))].filter((id) => permitted.includes(id))
}

export function isSmartbeeAgency(agencyId: number | null | undefined, raw = process.env.SMARTBEE_AGENCY_IDS): boolean {
  if (!agencyId || !Number.isSafeInteger(agencyId) || agencyId <= 0) return false
  return smartbeeAgencyIds(raw).includes(agencyId)
}

export function smartbeeProductionEnabled(): boolean {
  return process.env.SMARTBEE_PRODUCTION_ENABLED?.trim() === '1'
}
