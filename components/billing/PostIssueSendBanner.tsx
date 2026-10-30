'use client'

import { useEffect, useState } from 'react'
import { Btn } from '@/lib/btns/Btn'
import Icon from '@/lib/Icon'
import type { BillInvoiceRow } from '@/db/billing/invoices'
import { consumeJustIssuedFlag } from '@/lib/billing/justIssuedFlag'
import SendInvoiceModal from './SendInvoiceModal'
import { useInvoicePdfStatus } from './InvoicePdfLive'
import { useT } from '@/lib/i18n/I18nProvider'

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
  const t = useT()
  const [visible, setVisible] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const { status } = useInvoicePdfStatus()

  useEffect(() => {
    if (invoice.docState === 'draft') return
    if (consumeJustIssuedFlag(invoice.id)) setVisible(true)
  }, [invoice.id, invoice.docState])

  if (!visible) return null

  const isReceipt = invoice.kind === 'invoice_receipt'
  const isRendering = status !== 'ready' && status !== 'failed'
  const readyHeadline = isReceipt ? t('billing.issued.banner.ready.invoice_receipt') : t('billing.issued.banner.ready.invoice')
  const renderingHeadline = isReceipt ? t('billing.issued.banner.rendering.invoice_receipt') : t('billing.issued.banner.rendering.invoice')
  const headline = status === 'failed' ? t('billing.issued.banner.failed') : isRendering ? renderingHeadline : readyHeadline
  const subline = status === 'failed'
    ? t('billing.issued.banner.failedHint')
    : isRendering
      ? t('billing.issued.banner.renderingHint')
      : t('billing.issued.banner.readyHint')

  const accent = status === 'failed'
    ? { border: 'border-gray-200', bg: 'bg-gray-50', iconBg: 'bg-gray-600', text: 'text-gray-900', textSoft: 'text-gray-600' }
    : isRendering
      ? { border: 'border-gray-200', bg: 'bg-gray-50/80', iconBg: 'bg-gray-500', text: 'text-gray-900', textSoft: 'text-gray-600' }
      : { border: 'border-emerald-200', bg: 'bg-emerald-50/60', iconBg: 'bg-emerald-600', text: 'text-emerald-900', textSoft: 'text-emerald-800/80' }

  return (
    <>
      <section
        className={`rounded-xl border ${accent.border} ${accent.bg} px-6 py-5 flex flex-wrap items-center gap-x-6 gap-y-3`}
        data-testid='post-issue-send-banner'
        data-pdf-status={status}
      >
        <div className={`size-10 rounded-full bg-white border ${accent.border} flex items-center justify-center shrink-0`}>
          {isRendering ? (
            <span className='inline-block size-3 rounded-full bg-gray-500 animate-pulse' />
          ) : (
            <Icon name={status === 'failed' ? 'triangle-exclamation' : 'circle-check'} type='sol' className={`size-5 ${accent.iconBg}`} />
          )}
        </div>
        <div className='min-w-0 flex-1'>
          <p className={`text-base font-semibold ${accent.text}`}>{headline}</p>
          <p className={`text-sm mt-0.5 ${accent.textSoft}`}>{subline}</p>
        </div>
        <div className='flex items-center gap-2 shrink-0'>
          <Btn
            icon='paper-plane'
            lbl={isReceipt ? t('billing.issued.banner.send.invoice_receipt') : t('billing.issued.banner.send.invoice')}
            onClick={() => setModalOpen(true)}
            disabled={isRendering || status === 'failed'}
            title={isRendering ? t('billing.issued.pendingTitle') : status === 'failed' ? t('billing.issued.failedTitle') : undefined}
            data-testid='post-issue-send-banner-send'
          />
          <Btn
            variant='outline'
            lbl={t('billing.issued.banner.later')}
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
