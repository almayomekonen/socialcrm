import { BUSINESS_TZ } from '@/lib/today/constants'

/**
 * The first charge date, in one place, so the modal, the billing page, the
 * expired screen and the emails can never disagree.
 *
 * It is DERIVED FROM THE PERSISTED trial end — never recomputed as "today + 7"
 * anywhere else — and rendered in the business timezone, so a server running in
 * UTC does not show a customer in Israel the previous day.
 */

export function firstChargeAt(trialEndsAt: Date | string | null | undefined): Date | null {
  if (!trialEndsAt) return null
  const d = new Date(trialEndsAt)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatBillingDate(value: Date | string | null | undefined): string {
  const d = firstChargeAt(value)
  if (!d) return ''
  return new Intl.DateTimeFormat('he-IL', { timeZone: BUSINESS_TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d).replaceAll('.', '/')
}
