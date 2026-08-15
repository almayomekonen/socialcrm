/**
 * WhatsApp Contact vs Lead V1 rollout gate.
 *
 * ABSENCE BLOCKS. Until WA_CONTACTS_ENABLED === '1' AND the agency is on
 * WA_CONTACTS_AGENCY_ALLOWLIST, inbound WhatsApp keeps today's behaviour
 * (every inbound creates/attaches a Lead). Shipping this file changes
 * nothing in production.
 *
 * TWO DELIBERATE STEPS to reach a real tenant: the master switch AND a named
 * agency. An empty allowlist means NO agency. Canary the pilot agency first.
 *
 * Read per call, never cached at module scope.
 */

export function isWhatsappContactsEnabled(): boolean {
  return process.env.WA_CONTACTS_ENABLED === '1'
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

export function isWhatsappContactsAgencyAllowlisted(agencyId: number): boolean {
  const list = parseAllowlist(process.env.WA_CONTACTS_AGENCY_ALLOWLIST)
  return list === 'all' ? true : list.has(agencyId)
}

/** `next dev` only — NODE_ENV is set by the framework, not by Vercel config. */
export function isWhatsappContactsDevBypass(): boolean {
  return process.env.NODE_ENV === 'development'
}

export function canUseWhatsappContacts(agencyId: number | null | undefined): boolean {
  if (!agencyId) return false
  if (isWhatsappContactsDevBypass()) return true
  return isWhatsappContactsEnabled() && isWhatsappContactsAgencyAllowlisted(agencyId)
}
