/**
 * Temporary Facebook User Login rollout gate.
 *
 * FACEBOOK_USER_AUTH_* prefix — never reuse META_* or another subsystem's env.
 * Absence blocks: unset ENABLED or an empty allowlist means nobody, including
 * new Facebook registrations. Expand later by adding ids (`103,104,105`) or
 * `all` once the canary is over.
 *
 * Read per call, never cached at module scope.
 */

function parseAllowlist(raw: string | undefined): 'all' | Set<number> {
  const v = raw?.trim() ?? ''
  if (v === 'all') return 'all'
  const ids = v
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
  return new Set(ids)
}

export function isFacebookUserAuthEnabled(): boolean {
  return process.env.FACEBOOK_USER_AUTH_ENABLED === '1'
}

export function isFacebookUserAuthAgencyAllowlisted(agencyId: number): boolean {
  const list = parseAllowlist(process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST)
  return list === 'all' ? true : list.has(agencyId)
}

/** Existing SocialCRM user may complete Facebook login. */
export function canUseFacebookUserAuth(agencyId: number | null | undefined): boolean {
  if (!agencyId) return false
  return isFacebookUserAuthEnabled() && isFacebookUserAuthAgencyAllowlisted(agencyId)
}

/**
 * Anonymous /auth may show the Facebook button so an allowlisted agency's
 * users can sign in. The server action still rejects any non-allowlisted user.
 */
export function isFacebookUserAuthPubliclyAvailable(): boolean {
  if (!isFacebookUserAuthEnabled()) return false
  const list = parseAllowlist(process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST)
  return list === 'all' ? true : list.size > 0
}

/**
 * New-agency Facebook registration (addAgency + fb_login proof).
 * Closed during a numbered-id canary so we never create an unauthorized agency.
 */
export function isFacebookUserAuthOpenToNewAgencies(): boolean {
  if (!isFacebookUserAuthEnabled()) return false
  return parseAllowlist(process.env.FACEBOOK_USER_AUTH_AGENCY_ALLOWLIST) === 'all'
}
