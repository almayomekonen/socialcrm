/**
 * Notification gates — spec §23.1. NOTIFICATIONS_* prefix discipline, mirroring
 * the automation engine's AUTOMATIONS_* flags; never reusing another
 * subsystem's env var.
 *
 * ABSENCE BLOCKS. `NOTIFICATIONS_ENABLED !== '1'` means the system is OFF, so
 * the default state of a machine that has never heard of this feature — every
 * production and preview environment right now — is inert. Nothing is enqueued,
 * no table is touched, and `notifyEvent()` costs one string comparison.
 *
 * Read per call, never cached at module scope: flipping a flag must not require
 * a redeploy, and a kill switch you have to restart to use is not a kill switch.
 */

export function isNotificationsEnabled(): boolean {
  return process.env.NOTIFICATIONS_ENABLED === '1'
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

/**
 * Canary by agency id (the whatsapp-templates / automations allowlist pattern).
 * Empty ⇒ NO agency, so enabling the master switch alone still delivers nothing
 * until an agency is named. Two deliberate steps to reach a real user.
 */
export function isNotificationsAgencyAllowlisted(agencyId: number): boolean {
  const list = parseAllowlist(process.env.NOTIFICATIONS_AGENCY_ALLOWLIST)
  return list === 'all' ? true : list.has(agencyId)
}

/**
 * Channel gates for P3. Declared now so §23.1 is complete and the worker can
 * consult them without a later edit; both are OFF by default, which is what
 * keeps P1 to IN_APP even after the master switch is turned on.
 */
export function isNotificationsPushEnabled(): boolean {
  return process.env.NOTIFICATIONS_PUSH_ENABLED === '1'
}

export function isNotificationsEmailEnabled(): boolean {
  return process.env.NOTIFICATIONS_EMAIL_ENABLED === '1'
}
