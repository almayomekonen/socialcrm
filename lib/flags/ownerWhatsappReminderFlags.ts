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
 *   The agencies that may see the settings page and activate. Explicit ids
 *   only: absent or empty means none, and entries that are not plain digits
 *   (`all`, `*`, `true`) are ignored, so no value opens it to everyone.
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

export function ownerWhatsappReminderAgencyIds(): number[] {
  const ids = (process.env.OWNER_WA_REMINDERS_AGENCY_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number)
    .filter((n) => Number.isSafeInteger(n) && n > 0)
  return [...new Set(ids)]
}

/** The settings page and activation: allowlisted agency AND a configured platform number. */
export function canUseOwnerWhatsappReminders(agencyId: number | null | undefined): boolean {
  if (!agencyId || !Number.isSafeInteger(agencyId) || agencyId <= 0) return false
  if (!platformWhatsappPhoneNumberId() || !platformWhatsappWaMeNumber()) return false
  return ownerWhatsappReminderAgencyIds().includes(agencyId)
}
