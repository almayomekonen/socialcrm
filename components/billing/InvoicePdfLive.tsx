'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getInvoicePdfStatusAction, type InvoicePdfStatusSnapshot, type InvoicePdfStatusValue } from '@/actions/billing/documentStatus'
import { StatusBadge, type StatusRole } from '@/lib/StatusBadge'
import { useT } from '@/lib/i18n/I18nProvider'
import type { MessageKey } from '@/lib/i18n/translate'

const FAST_INTERVAL_MS = 1500
const SLOW_INTERVAL_MS = 5000
const SLOW_AFTER_MS = 30_000
const HARD_STOP_MS = 5 * 60 * 1000

function isTerminal(status: InvoicePdfStatusValue): boolean {
  return status === 'ready' || status === 'failed'
}

const InvoicePdfStatusContext = createContext<InvoicePdfStatusSnapshot | null>(null)

export function useInvoicePdfStatus(): InvoicePdfStatusSnapshot {
  const ctx = useContext(InvoicePdfStatusContext)
  if (!ctx) throw new Error('useInvoicePdfStatus must be used inside <InvoicePdfStatusProvider>')
  return ctx
}

export function InvoicePdfStatusProvider({
  invoiceId,
  initial,
  children,
}: {
  invoiceId: number
  initial: InvoicePdfStatusSnapshot
  children: React.ReactNode
}) {
  const router = useRouter()
  const [snapshot, setSnapshot] = useState<InvoicePdfStatusSnapshot>(initial)
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot

  useEffect(() => {
    if (isTerminal(initial.status)) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const startedAt = Date.now()

    function intervalFor(elapsed: number): number {
      return elapsed < SLOW_AFTER_MS ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS
    }

    async function tick() {
      if (cancelled) return
      const elapsed = Date.now() - startedAt
      if (elapsed > HARD_STOP_MS) return
      if (typeof document !== 'undefined' && document.hidden) {
        timer = setTimeout(tick, intervalFor(elapsed))
        return
      }
      try {
        const next = await getInvoicePdfStatusAction(invoiceId)
        if (cancelled) return
        const prev = snapshotRef.current
        if (next.status !== prev.status || next.url !== prev.url || next.errorReason !== prev.errorReason) {
          setSnapshot(next)
          if (isTerminal(next.status)) {
            // Soft-refresh the RSC tree on terminal so any status-derived
            // UI outside this Provider syncs too. Preserves client state.
            router.refresh()
          }
        }
        if (isTerminal(next.status)) return
      } catch {
        // Transient errors are ignored; next tick retries.
      }
      timer = setTimeout(tick, intervalFor(Date.now() - startedAt))
    }

    timer = setTimeout(tick, FAST_INTERVAL_MS)

    function onVisibility() {
      if (typeof document === 'undefined' || document.hidden) return
      if (isTerminal(snapshotRef.current.status)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(tick, 0)
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }
  }, [invoiceId, initial.status, router])

  return <InvoicePdfStatusContext.Provider value={snapshot}>{children}</InvoicePdfStatusContext.Provider>
}

const STATUS_KEYS: Record<InvoicePdfStatusValue, MessageKey> = {
  none: 'billing.issued.pdf.none',
  rendering: 'billing.issued.pdf.rendering',
  ready: 'billing.issued.pdf.ready',
  failed: 'billing.issued.pdf.failed',
}

const STATUS_ROLE: Record<InvoicePdfStatusValue, StatusRole> = {
  none: 'neutral',
  rendering: 'info',
  ready: 'success',
  failed: 'error',
}

export function InvoicePdfStatusChipLive() {
  const t = useT()
  const { status } = useInvoicePdfStatus()
  return (
    <StatusBadge
      role={STATUS_ROLE[status]}
      label={t(STATUS_KEYS[status])}
      size='xs'
      pulse={status === 'rendering'}
      data-pdf-status={status}
    />
  )
}

/** The renderer's own error text is external (shown as stored, usually English). */
export function InvoicePdfErrorReasonLive() {
  const t = useT()
  const { status, errorReason } = useInvoicePdfStatus()
  if (status !== 'failed' || !errorReason) return null
  return <span className='ms-2 text-gray-600'>{t('billing.issued.pdf.errorReason', { reason: errorReason })}</span>
}
