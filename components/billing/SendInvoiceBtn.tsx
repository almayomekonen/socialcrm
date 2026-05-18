'use client'

import { useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import type { BillInvoiceRow } from '@/db/billing/invoices'
import SendInvoiceModal from './SendInvoiceModal'

/**
 * Thin trigger that opens the SendInvoiceModal. Two visual variants:
 *   - 'hero'    : meant for the dark hero band on the issued view
 *                 (white solid background pops against the dark surface).
 *   - 'default' : standard solid button for any other context.
 *
 * Hides itself entirely for draft invoices (sending an unfinalized invoice
 * is semantically wrong — the user must issue first).
 *
 * Post-issue prompting now lives in PostIssueSendBanner (a dedicated
 * visible callout). This component intentionally has no URL-driven
 * auto-open behavior — clicking is the only way it opens.
 */
export default function SendInvoiceBtn({
  invoice,
  fallbackEmail,
  variant = 'default',
  disabled = false,
  disabledReason,
}: {
  invoice: BillInvoiceRow
  fallbackEmail?: string | null
  variant?: 'hero' | 'default'
  disabled?: boolean
  disabledReason?: string
}) {
  const [open, setOpen] = useState(false)

  if (invoice.docState === 'draft') return null

  const onClick = () => {
    if (disabled) return
    setOpen(true)
  }

  return (
    <>
      {variant === 'hero' ? (
        <button
          type='button'
          onClick={onClick}
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          className='inline-flex items-center gap-2 h-10 px-4 rounded-md bg-white text-dark hover:bg-white/90 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white'
        >
          <span>שלח חשבונית</span>
        </button>
      ) : (
        <Btn
          icon='paper-plane'
          lbl='שלח חשבונית'
          onClick={onClick}
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
        />
      )}
      <SendInvoiceModal
        invoice={invoice}
        fallbackEmail={fallbackEmail}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
