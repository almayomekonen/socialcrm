'use client'

import { useCrmSyncHealth } from '@/lib/polling/CrmSyncHealthContext'
import type { CrmSyncSource } from '@/lib/polling/syncFailure'

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
        בעיית חיבור — מנסה שוב
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
