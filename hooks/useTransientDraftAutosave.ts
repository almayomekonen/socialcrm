'use client'

import { useEffect, useRef } from 'react'
import type { DocumentKind } from '@/db/billing/invoices'
import type { PaymentMethod } from '@/lib/billing/payment/methods'

/**
 * sessionStorage-backed transient autosave for the /billing/new flow.
 *
 * The page header says "אין שמירה אוטומטית" — that's the SERVER
 * guarantee (no DB writes until explicit save). But losing typed work
 * to an accidental browser-back or customer-switch is real user pain.
 * Storing locally is a no-server middle ground: data survives nav
 * within the tab, dies on tab close, never leaves the user's machine.
 *
 * W3 isolation:
 *   The storage key includes BOTH userId and leadId. sessionStorage is
 *   per-tab, but does not auto-clear on logout — so without userId
 *   scoping a User B who logs in to the same tab User A used could
 *   hydrate A's typed content. Scoping by userId closes that privacy
 *   leak. On logout we also clear the namespace via clearAllAutosaved().
 *
 * Two effects:
 *   1. Hydration — runs once on mount. Reads sessionStorage and pushes
 *      values back into the parent state via the provided setters.
 *      Guarded by `hydratedRef` so the persist effect doesn't blow
 *      away saved state with the initial empty render.
 *   2. Persist — runs on every change. Writes the full state under
 *      the keyed slot, OR removes the slot if empty.
 *
 * Returns `clearStoredDraft` for callers to invoke after a successful
 * save (the local recovery copy becomes obsolete once persisted
 * server-side).
 */

const STORAGE_PREFIX = 'billing.new.draft.'

/**
 * Auth-out hook should call this to wipe every user's autosave from this
 * browsing session — defense-in-depth against shared-machine leakage.
 */
export function clearAllAutosavedDrafts(): void {
  if (typeof window === 'undefined') return
  try {
    const drop: string[] = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      if (key && key.startsWith(STORAGE_PREFIX)) drop.push(key)
    }
    for (const k of drop) sessionStorage.removeItem(k)
  } catch {
    // ignore — quota / private mode
  }
}

type TransientLine = {
  id: number
  title: string
  description: string
  quantity: number
  unitPrice: number
  discount: number
  lineSubtotal: number
  lineTaxAmount: number
  lineTotal: number
}

export function useTransientDraftAutosave({
  userId,
  leadId,
  lines,
  dueAt,
  customerFooter,
  internalNotes,
  kind,
  paymentMethod,
  paymentAmount,
  paymentDate,
  setLines,
  setDueAt,
  setCustomerFooter,
  setInternalNotes,
  setKind,
  setPaymentMethod,
  setPaymentAmount,
  setPaymentDate,
}: {
  userId: number
  leadId: number
  lines: TransientLine[]
  dueAt: string
  customerFooter: string
  internalNotes: string
  kind: DocumentKind
  paymentMethod: PaymentMethod | ''
  paymentAmount: number | null
  paymentDate: string
  setLines: (lines: TransientLine[]) => void
  setDueAt: (v: string) => void
  setCustomerFooter: (v: string) => void
  setInternalNotes: (v: string) => void
  setKind: (v: DocumentKind) => void
  setPaymentMethod: (v: PaymentMethod | '') => void
  setPaymentAmount: (v: number | null) => void
  setPaymentDate: (v: string) => void
}) {
  // W3 — key is scoped by both userId and leadId so a user-B logging in
  // to the same tab a user-A used cannot hydrate user-A's typed content
  // even though sessionStorage survives the logout.
  const storageKey = `${STORAGE_PREFIX}user_${userId}.lead_${leadId}`
  const hydratedRef = useRef(false)

  // Hydration (runs once per mount per leadId).
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (raw) {
        const saved = JSON.parse(raw) as Partial<{
          lines: TransientLine[]
          dueAt: string
          customerFooter: string
          internalNotes: string
          kind: DocumentKind
          paymentMethod: PaymentMethod | ''
          paymentAmount: number | null
          paymentDate: string
        }>
        if (Array.isArray(saved.lines)) setLines(saved.lines)
        if (typeof saved.dueAt === 'string') setDueAt(saved.dueAt)
        if (typeof saved.customerFooter === 'string') setCustomerFooter(saved.customerFooter)
        if (typeof saved.internalNotes === 'string') setInternalNotes(saved.internalNotes)
        if (saved.kind === 'invoice' || saved.kind === 'invoice_receipt') setKind(saved.kind)
        if (typeof saved.paymentMethod === 'string') setPaymentMethod(saved.paymentMethod as PaymentMethod | '')
        if (saved.paymentAmount == null || typeof saved.paymentAmount === 'number') setPaymentAmount(saved.paymentAmount ?? null)
        if (typeof saved.paymentDate === 'string') setPaymentDate(saved.paymentDate)
      }
    } catch {
      // Corrupt entry — fall through, user starts fresh.
    }
    hydratedRef.current = true
    // The setters are intentionally NOT in deps — they're stable
    // useState setters from the parent and including them would
    // re-fire hydration on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  // Persist on every state change. Skipped until after hydration.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!hydratedRef.current) return
    const hasContent =
      lines.length > 0 ||
      dueAt.length > 0 ||
      customerFooter.length > 0 ||
      internalNotes.length > 0 ||
      kind === 'invoice_receipt' ||
      paymentMethod.length > 0 ||
      paymentAmount != null ||
      paymentDate.length > 0
    try {
      if (!hasContent) {
        sessionStorage.removeItem(storageKey)
      } else {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            lines,
            dueAt,
            customerFooter,
            internalNotes,
            kind,
            paymentMethod,
            paymentAmount,
            paymentDate,
            savedAt: Date.now(),
          }),
        )
      }
    } catch {
      // Quota exceeded or storage denied — fail silently.
    }
  }, [lines, dueAt, customerFooter, internalNotes, kind, paymentMethod, paymentAmount, paymentDate, storageKey])

  function clearStoredDraft(): void {
    if (typeof window === 'undefined') return
    try {
      sessionStorage.removeItem(storageKey)
    } catch {
      // ignore
    }
  }

  return { clearStoredDraft }
}
