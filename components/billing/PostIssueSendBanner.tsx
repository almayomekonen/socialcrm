'use client'

import { useEffect, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import type { BillInvoiceRow } from '@/db/billing/invoices'
import { consumeJustIssuedFlag } from '@/lib/billing/justIssuedFlag'
import SendInvoiceModal from './SendInvoiceModal'

/**
 * Post-issue send prompt. Replaces the prior ?send=1 URL-driven auto-open.
 *
 * Visibility contract (one-shot, explicit):
 *   - Renders nothing on the server (avoids hydration flicker).
 *   - On client mount, calls consumeJustIssuedFlag() — returns true exactly
 *     once per invoice issuance, on the FIRST visit to the issued view.
 *   - "מאוחר יותר" hides the banner for this view. The flag is already
 *     consumed by mount, so a refresh after dismissal stays hidden.
 *   - "שלח חשבונית" opens the existing SendInvoiceModal in place.
 *
 * Inspection-first: the banner sits above the hero band but does not block
 * scrolling or interaction with the document. The user can review the
 * invoice in full before deciding to send.
 */
export default function PostIssueSendBanner({
  invoice,
  fallbackEmail,
}: {
  invoice: BillInvoiceRow
  fallbackEmail?: string | null
}) {
  const [visible, setVisible] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    if (invoice.docState === 'draft') return
    if (consumeJustIssuedFlag(invoice.id)) setVisible(true)
  }, [invoice.id, invoice.docState])

  if (!visible) return null

  const kindNoun = invoice.kind === 'invoice_receipt' ? 'חשבונית/קבלה' : 'חשבונית'
  const readyHeadline = invoice.kind === 'invoice_receipt' ? 'חשבונית/קבלה מוכנה' : 'החשבונית מוכנה'

  return (
    <>
      <section
        className='rounded-xl border border-emerald-200 bg-emerald-50/60 px-6 py-5 flex flex-wrap items-center gap-x-6 gap-y-3'
        data-testid='post-issue-send-banner'
      >
        <div className='size-10 rounded-full bg-white border border-emerald-200 flex items-center justify-center shrink-0'>
          <Icon name='circle-check' type='sol' className='size-5 bg-emerald-600' />
        </div>
        <div className='min-w-0 flex-1'>
          <p className='text-base font-semibold text-emerald-900'>{readyHeadline}</p>
          <p className='text-sm text-emerald-800/80 mt-0.5'>לשלוח ללקוח עכשיו?</p>
        </div>
        <div className='flex items-center gap-2 shrink-0'>
          <Btn
            icon='paper-plane'
            lbl={`שלח ${kindNoun}`}
            onClick={() => setModalOpen(true)}
            data-testid='post-issue-send-banner-send'
          />
          <Btn
            variant='outline'
            lbl='מאוחר יותר'
            onClick={() => setVisible(false)}
            data-testid='post-issue-send-banner-later'
          />
        </div>
      </section>

      <SendInvoiceModal
        invoice={invoice}
        fallbackEmail={fallbackEmail}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </>
  )
}
