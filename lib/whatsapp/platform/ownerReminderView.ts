import type { OwnRecipientRow } from '@/db/ownerWhatsappRecipients'
import { consentCoversAssistant, consentCoversPersonalReminders } from './consentText'

/**
 * What the settings page shows for the session's own row. Pure. An expired code
 * is shown as "off": the code is only ever displayed once, right after it is
 * issued, and an expired one can never activate anything.
 */
export type OwnerReminderView = {
  state: 'off' | 'pending' | 'active' | 'opted_out'
  /** Last two digits only, e.g. `••••••72`. Never the full number. */
  maskedPhone: string | null
  /**
   * Conversations with the assistant, for an ACTIVE row of an agency where it is
   * enabled: `granted` only for the assistant's own consent (v3); a reminders-only
   * consent is `consent_required`. Otherwise `not_offered`.
   */
  assistant: 'not_offered' | 'consent_required' | 'granted'
  /**
   * Personal reminders (consent v5), for an ACTIVE row whose assistant consent
   * is granted, in an agency where they are switched on: `granted` only for v5.
   * Otherwise `not_offered` (absent means the same). v4 never counts as granted.
   */
  personalReminders?: 'not_offered' | 'consent_required' | 'granted'
}

export function maskPhone(phoneE164: string | null): string | null {
  return phoneE164 && phoneE164.length >= 4 ? `••••••${phoneE164.slice(-2)}` : null
}

export function ownerReminderView(
  row: OwnRecipientRow | null,
  now: Date,
  opts: { assistantEnabled?: boolean; personalRemindersEnabled?: boolean } = {},
): OwnerReminderView {
  const assistant = 'not_offered' as const
  const personalReminders = 'not_offered' as const
  if (!row) return { state: 'off', maskedPhone: null, assistant, personalReminders }
  if (row.status === 'active') {
    const assistantState = !opts.assistantEnabled ? assistant : consentCoversAssistant(row.consentTextVersion) ? 'granted' : 'consent_required'
    return {
      state: 'active',
      maskedPhone: maskPhone(row.phoneE164),
      assistant: assistantState,
      personalReminders:
        !opts.personalRemindersEnabled || assistantState !== 'granted'
          ? personalReminders
          : consentCoversPersonalReminders(row.consentTextVersion)
            ? 'granted'
            : 'consent_required',
    }
  }
  if (row.status === 'opted_out') return { state: 'opted_out', maskedPhone: null, assistant, personalReminders }
  const live = !!row.activationExpiresAt && new Date(row.activationExpiresAt).getTime() > now.getTime()
  return { state: live ? 'pending' : 'off', maskedPhone: null, assistant, personalReminders }
}
