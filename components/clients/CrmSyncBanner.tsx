'use client'

import { useCrmSyncHealth } from '@/lib/polling/CrmSyncHealthContext'
import type { CrmSyncSource } from '@/lib/polling/syncFailure'
import { isAccessDenied } from '@/lib/entitlement/pollGate'
import SubscriptionExpiredState from '@/components/entitlement/SubscriptionExpiredState'

type Props = {
  sources: CrmSyncSource[]
  /** Compact single-line bar for inbox list column (must not cover composer). */
  compact?: boolean
}

/**
 * Amber sync/network banner — reuses MetaDisconnected visual language.
 * Shows after consecutive failure threshold; Retry triggers immediate poll.
 */
export default function CrmSyncBanner({ sources, compact = false }: Props) {
  const { get, isBannerVisible } = useCrmSyncHealth()
  const active = sources.find((s) => isBannerVisible(s))
  if (!active) return null

  /**
   * A LAPSED SUBSCRIPTION IS NOT A CONNECTION PROBLEM.
   *
   * This banner fires on consecutive failure COUNT, with no idea what the
   * failures were — so a permanent `403 product-access-required` produced
   * "בעיית חיבור — מנסה שוב" plus a retry button that could never succeed. The
   * live production audit found it still on screen after the poller itself had
   * correctly stopped.
   *
   * THE DISTINCTION IS DELIBERATE, and keyed on `isAccessDenied()` — which
   * latches ONLY on a 403 from the polled endpoints, never on a 5xx or a network
   * drop. So:
   *   403 entitlement  → the locked state below, no retry, no auto-retry
   *   500 / network    → the amber connection banner, unchanged, retry intact
   * A genuine infrastructure failure is still reported as one, including on an
   * expired account, because a 500 never sets the latch.
   */
  if (isAccessDenied()) {
    return (
      <div className={compact ? 'border-b border-gray-200 px-3 py-2' : 'mb-4'}>
        <SubscriptionExpiredState mode='inline' source='crm_sync_banner' feature='חידוש המנוי מחזיר את הסנכרון החי' />
      </div>
    )
  }

  const health = get(active)

  return (
    <div
      role='status'
      aria-live='polite'
      className={
        compact
          ? 'flex items-center justify-between gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs'
          : 'mb-4 flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3'
      }
    >
      <p className={`font-semibold text-amber-900 ${compact ? 'text-xs leading-snug' : 'text-sm'}`}>
        בעיית חיבור. מנסים שוב
      </p>
      {health.retry && (
        <button
          type='button'
          onClick={() => health.retry?.()}
          className={
            compact
              ? 'shrink-0 rounded-md bg-solid px-3 py-1.5 text-xs font-semibold text-white hover:bg-solid/85'
              : 'shrink-0 rounded-md bg-solid px-4 py-2 text-sm font-semibold text-white hover:bg-solid/85'
          }
        >
          נסה שוב
        </button>
      )}
    </div>
  )
}
