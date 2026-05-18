'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getInvoicePdfStatusAction, type InvoicePdfStatusSnapshot, type InvoicePdfStatusValue } from '@/actions/billing/documentStatus'

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
    if (isTerminal(initial.status)) {
      console.log('[invoice-pdf-live] terminal initial state, no polling', { invoiceId, status: initial.status })
      return
    }

    console.log('[invoice-pdf-live] polling started', { invoiceId, initial: initial.status })

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const startedAt = Date.now()
    let tickCount = 0

    function intervalFor(elapsed: number): number {
      return elapsed < SLOW_AFTER_MS ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS
    }

    async function tick() {
      if (cancelled) return
      const elapsed = Date.now() - startedAt
      if (elapsed > HARD_STOP_MS) {
        console.warn('[invoice-pdf-live] hard stop reached', { invoiceId, elapsed })
        return
      }
      if (typeof document !== 'undefined' && document.hidden) {
        timer = setTimeout(tick, intervalFor(elapsed))
        return
      }
      tickCount += 1
      try {
        const next = await getInvoicePdfStatusAction(invoiceId)
        if (cancelled) return
        const prev = snapshotRef.current
        console.log('[invoice-pdf-live] tick', { invoiceId, tick: tickCount, elapsed, prev: prev.status, next: next.status, url: next.url ? 'present' : 'null' })
        if (next.status !== prev.status || next.url !== prev.url || next.errorReason !== prev.errorReason) {
          setSnapshot(next)
          if (isTerminal(next.status)) {
            router.refresh()
          }
        }
        if (isTerminal(next.status)) {
          console.log('[invoice-pdf-live] terminal reached, stopping', { invoiceId, status: next.status })
          return
        }
      } catch (err) {
        console.warn('[invoice-pdf-live] tick error (will retry)', { invoiceId, err: err instanceof Error ? err.message : String(err) })
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

const STATUS_LABELS: Record<InvoicePdfStatusValue, string> = {
  none: 'PDF בקרוב',
  rendering: 'מופק כעת',
  ready: 'מסמך זמין',
  failed: 'שגיאה בהפקה',
}

const STATUS_CLASSES: Record<InvoicePdfStatusValue, string> = {
  none: 'border-gray-200 bg-gray-50 text-gray-600',
  rendering: 'border-gray-200 bg-gray-50 text-gray-600',
  ready: 'border-gray-300 bg-white text-gray-800',
  failed: 'border-gray-200 bg-gray-100 text-gray-600',
}

export function InvoicePdfStatusChipLive() {
  const { status } = useInvoicePdfStatus()
  return (
    <span
      data-pdf-status={status}
      className={`inline-flex shrink-0 items-center px-1.5 py-0.5 rounded-full border text-[10px] leading-tight font-medium ${STATUS_CLASSES[status]}`}
    >
      {status === 'rendering' && <span className='me-1 inline-block size-1.5 rounded-full bg-gray-500 animate-pulse' />}
      {STATUS_LABELS[status]}
    </span>
  )
}

export function InvoicePdfErrorReasonLive() {
  const { status, errorReason } = useInvoicePdfStatus()
  if (status !== 'failed' || !errorReason) return null
  return <span className='ms-2 text-gray-600'>· שגיאת הפקה: {errorReason}</span>
}
