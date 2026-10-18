/**
 * Owner WhatsApp reminders: rollout gates. ABSENCE BLOCKS everywhere.
 *
 * PLATFORM_WHATSAPP_PHONE_NUMBER_ID
 *   The Meta phone number id of SocialCRM's own WhatsApp number. Unset means
 *   the webhook has no platform branch at all: every payload takes the agency
 *   path exactly as before. When set, webhook changes for that number are
 *   handled by `lib/whatsapp/platform` and never reach agency code. Opt-outs
 *   are honoured whenever this is set, whatever the allowlist says.
 *
 * PLATFORM_WHATSAPP_WA_ME_NUMBER
 *   The same number as wa.me digits, for the activation link. Kept in
 *   configuration rather than code.
 *
 * OWNER_WA_REMINDERS_AGENCY_IDS
 *   The agencies that may see the settings page and activate, while the
 *   audience is not `all`. Explicit ids only: absent or empty means none, and
 *   entries that are not plain digits (`all`, `*`, `true`) are ignored, so no
 *   value of THIS variable opens it to everyone.
 *
 * OWNER_WA_REMINDERS_AUDIENCE
 *   Exactly `all` opens the feature to every agency (the general rollout).
 *   Absent or any other value keeps the explicit-id list above. Product access
 *   (PAID / TRIAL_ACTIVE / LEGACY) and each user's own verified consent are
 *   still required everywhere; see lib/ownerWhatsappReminders/productAccess.ts.
 *
 * OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS
 *   Agencies never included, in either mode (explicit ids, same parser). The
 *   only exclusion list; no agency is excluded in code.
 *
 * PLATFORM_WHATSAPP_ACCESS_TOKEN (PR B, sensitive)
 *   System User token for the platform WABA. Used only by the reminder sender
 *   and the read-only readiness check. Never logged.
 *
 * PLATFORM_WHATSAPP_WABA_ID (PR B)
 *   The platform WABA id. Used only by the readiness check to read the
 *   template's status. Never used to route webhook traffic.
 *
 * OWNER_WA_REMINDERS_SEND_ENABLED (PR B, the kill switch)
 *   Exactly `1` sends. Anything else (including unset) is a dry run: the tick
 *   computes what it would do, logs counts, and writes nothing.
 *
 * OWNER_WA_ONE_OFF_RECIPIENT_ID (one-off test send)
 *   The id of the ONE agency-103 recipient row the internal one-off test route
 *   may send to (lib/ownerWhatsappReminders/oneOffSend.ts). Unset means the
 *   route answers 404. It never enables OWNER_WA_REMINDERS_SEND_ENABLED and is
 *   removed again after the test.
 *
 * Read per call, never cached at module scope.
 */

const digitsOnly = (raw: string | undefined): string | null => {
  const v = raw?.trim() ?? ''
  return /^\d{5,20}$/.test(v) ? v : null
}

export function platformWhatsappPhoneNumberId(): string | null {
  return digitsOnly(process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID)
}

export function platformWhatsappWaMeNumber(): string | null {
  return digitsOnly(process.env.PLATFORM_WHATSAPP_WA_ME_NUMBER)
}

function parseAgencyIds(raw: string | undefined): number[] {
  const ids = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0)
  return [...new Set(ids)]
}

/** The raw explicit-id list (OWNER_WA_REMINDERS_AGENCY_IDS). Prefer `ownerWhatsappReminderAudience()`. */
export function ownerWhatsappReminderAgencyIds(): number[] {
  return parseAgencyIds(process.env.OWNER_WA_REMINDERS_AGENCY_IDS)
}

/**
 * Who the feature is open to. `all`: every agency except `excludedIds`.
 * `list`: exactly `agencyIds`. Excluded ids always win, in both modes.
 */
export type OwnerWaAudience = { mode: 'all'; excludedIds: number[] } | { mode: 'list'; agencyIds: number[]; excludedIds: number[] }

export function ownerWhatsappReminderAudience(): OwnerWaAudience {
  const excludedIds = parseAgencyIds(process.env.OWNER_WA_REMINDERS_EXCLUDED_AGENCY_IDS)
  if (process.env.OWNER_WA_REMINDERS_AUDIENCE?.trim() === 'all') return { mode: 'all', excludedIds }
  return { mode: 'list', agencyIds: ownerWhatsappReminderAgencyIds().filter((id) => !excludedIds.includes(id)), excludedIds }
}

/** True when at least one agency can be in the audience. */
export function hasOwnerWhatsappReminderAudience(audience: OwnerWaAudience = ownerWhatsappReminderAudience()): boolean {
  return audience.mode === 'all' || audience.agencyIds.length > 0
}

export function isOwnerWhatsappReminderAgency(agencyId: number | null | undefined, audience: OwnerWaAudience = ownerWhatsappReminderAudience()): boolean {
  if (!agencyId || !Number.isSafeInteger(agencyId) || agencyId <= 0) return false
  if (audience.excludedIds.includes(agencyId)) return false
  return audience.mode === 'all' || audience.agencyIds.includes(agencyId)
}

/**
 * The settings page and activation: an agency in the audience AND a configured
 * platform number. Product access is checked by the callers (it needs a read).
 */
export function canUseOwnerWhatsappReminders(agencyId: number | null | undefined): boolean {
  if (!platformWhatsappPhoneNumberId() || !platformWhatsappWaMeNumber()) return false
  return isOwnerWhatsappReminderAgency(agencyId)
}

export function platformWhatsappAccessToken(): string | null {
  const v = process.env.PLATFORM_WHATSAPP_ACCESS_TOKEN?.trim() ?? ''
  return v.length >= 20 ? v : null
}

export function platformWhatsappWabaId(): string | null {
  return digitsOnly(process.env.PLATFORM_WHATSAPP_WABA_ID)
}

/** The kill switch: only the exact value `1` sends. */
export function isOwnerWhatsappReminderSendEnabled(): boolean {
  return process.env.OWNER_WA_REMINDERS_SEND_ENABLED === '1'
}

/** The one recipient row the one-off test route may send to, or null (route off). */
export function ownerWhatsappOneOffRecipientId(): number | null {
  const v = process.env.OWNER_WA_ONE_OFF_RECIPIENT_ID?.trim() ?? ''
  if (!/^\d{1,12}$/.test(v)) return null
  const n = Number(v)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}
