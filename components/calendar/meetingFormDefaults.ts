import type { MessageKey } from '@/lib/i18n/translate'

/**
 * The new-meeting form's prefill times and its `createMeeting` refusal copy
 * (by reason CODE). Moved out of MeetingFormDialog, over the 250-line soft
 * limit (architecture-rules §1); unchanged.
 */

export function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function defaultStartDate(): Date {
  const t = new Date()
  t.setMinutes(0, 0, 0)
  t.setHours(t.getHours() + 1)
  return t
}

export function defaultEndDate(start: Date): Date {
  const t = new Date(start)
  t.setHours(t.getHours() + 1)
  return t
}

/** `createMeeting` refusals by reason CODE; anything else reads `createError.generic`. */
export const ERROR_KEYS: Record<string, MessageKey> = {
  invalid_input: 'calendar.form.createError.invalid_input',
  lead_not_found: 'calendar.form.createError.lead_not_found',
  not_found: 'calendar.form.createError.not_found',
  not_owner: 'calendar.form.createError.not_owner',
  already_synced: 'calendar.form.createError.already_synced',
}
