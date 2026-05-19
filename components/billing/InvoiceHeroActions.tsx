'use client'

import Icon from '@/lib/Icon'
import type { BillInvoiceRow } from '@/db/billing/invoices'
import DuplicateInvoiceBtn from './DuplicateInvoiceBtn'
import RerenderPdfBtn from './RerenderPdfBtn'
import SendInvoiceBtn from './SendInvoiceBtn'
import { useInvoicePdfStatus } from './InvoicePdfLive'

export default function InvoiceHeroActions({ invoice }: { invoice: BillInvoiceRow }) {
  const { status, url } = useInvoicePdfStatus()
  const ready = status === 'ready' && !!url
  const failed = status === 'failed'
  const sendTitle = ready ? undefined : failed ? 'יש לנסות להפיק את ה-PDF מחדש' : 'המסמך עדיין מופק…'

  return (
    <div className='flex items-center gap-2 shrink-0'>
      <SendInvoiceBtn invoice={invoice} variant='hero' disabled={!ready} disabledReason={sendTitle} />

      {ready && url && (
        <a
          href={`/api/billing/invoice/${invoice.id}/download`}
          target='_blank'
          rel='noopener noreferrer'
          className='inline-flex items-center gap-2 h-10 px-4 rounded-md border border-white/20 bg-white/5 hover:bg-white/10 text-white font-semibold transition-colors'
          data-testid='invoice-download-pdf'
        >
          <Icon name='download' type='reg' className='size-4 bg-white' />
          <span>הורד PDF</span>
        </a>
      )}

      {!ready && !failed && (
        <span
          className='inline-flex items-center gap-2 h-10 px-4 rounded-md border border-white/15 bg-white/5 text-white/80 text-sm'
          data-testid='invoice-pdf-pending'
        >
          <span className='inline-block size-2 rounded-full bg-white/70 animate-pulse' />
          <span>מופק כעת…</span>
        </span>
      )}

      {failed && <RerenderPdfBtn invoiceId={invoice.id} leadId={invoice.leadId} lbl='נסה שוב' />}

      <DuplicateInvoiceBtn invoiceId={invoice.id} leadId={invoice.leadId} variant='hero' />
    </div>
  )
}
