import type { OwnRecipientRow } from '@/db/ownerWhatsappRecipients'

/**
 * What the settings page shows for the session's own row. Pure. An expired code
 * is shown as "off": the code is only ever displayed once, right after it is
 * issued, and an expired one can never activate anything.
 */
export type OwnerReminderView = {
  state: 'off' | 'pending' | 'active' | 'opted_out'
  /** Last two digits only, e.g. `••••••72`. Never the full number. */
  maskedPhone: string | null
}

export function maskPhone(phoneE164: string | null): string | null {
  return phoneE164 && phoneE164.length >= 4 ? `••••••${phoneE164.slice(-2)}` : null
}

export function ownerReminderView(row: OwnRecipientRow | null, now: Date): OwnerReminderView {
  if (!row) return { state: 'off', maskedPhone: null }
  if (row.status === 'active') return { state: 'active', maskedPhone: maskPhone(row.phoneE164) }
  if (row.status === 'opted_out') return { state: 'opted_out', maskedPhone: null }
  const live = !!row.activationExpiresAt && new Date(row.activationExpiresAt).getTime() > now.getTime()
  return { state: live ? 'pending' : 'off', maskedPhone: null }
}
