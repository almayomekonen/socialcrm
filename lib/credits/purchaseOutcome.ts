import type { PackPurchaseRow } from '@/db/credits/purchases'

/**
 * What the purchase page says about the latest purchase, from the billing row
 * alone, so it is the same after a closed browser or a reload as it was on the
 * first screen. Only a row Grow confirmed can read as a success.
 */
export type PurchaseOutcome = { state: 'success'; credits: number | null } | { state: 'confirming' } | { state: 'declined' } | null

const HOUR = 3_600_000

export function purchaseOutcome(latest: PackPurchaseRow | undefined, nowMs: number): PurchaseOutcome {
  if (!latest) return null
  if (latest.status === 'succeeded') return latest.succeededAt && nowMs - latest.succeededAt.getTime() <= 24 * HOUR ? { state: 'success', credits: latest.credits } : null
  if (latest.status === 'unknown' || latest.status === 'in_flight') return { state: 'confirming' }
  const age = nowMs - latest.createdAt.getTime()
  if (latest.status === 'pending') return age <= HOUR / 4 ? { state: 'confirming' } : null
  if (latest.status === 'failed_final' || latest.status === 'failed_retryable') return age <= HOUR ? { state: 'declined' } : null
  return null
}

/** Opens the SocialCRM WhatsApp chat. Prefilled text is only a draft: the customer sends it, or not. */
export function whatsappReturnHref(number: string | null, draft: string | null): string | null {
  if (!number) return null
  return draft ? `https://wa.me/${number}?text=${encodeURIComponent(draft)}` : `https://wa.me/${number}`
}
