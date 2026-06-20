import { Suspense } from 'react'
import Link from 'next/link'
import type { BillInvoiceRow, BillInvoiceLineRow } from '@/db/billing/invoices'
import type { BillDocumentRow } from '@/db/billing/documents'
import type { InvoicePdfStatusSnapshot } from '@/actions/billing/documentStatus'
import { formatDate } from '@/lib/dates'
import { formatCurrency } from '@/lib/funcs'
import { DocStateChip, FulfillStateChip } from './chips'
import { formatInvoiceNumber } from './funcs'
import { documentKindLabel } from '@/lib/billing/documentKinds'
import { paymentMethodLabel } from '@/lib/billing/payment/methods'
import InvoiceTimelineList from './InvoiceTimelineList'
import PostIssueSendBanner from './PostIssueSendBanner'
import InvoiceHeroActions from './InvoiceHeroActions'
import { InvoicePdfStatusProvider, InvoicePdfStatusChipLive, InvoicePdfErrorReasonLive } from './InvoicePdfLive'


export default function InvoiceFrozenView({
  invoice,
  lines,
  document,
}: {
  invoice: BillInvoiceRow
  lines: BillInvoiceLineRow[]
  document: BillDocumentRow | null
}) {
  const initialStatus = toInitialStatus(invoice, document)
  const recipientHref = `/clients/${invoice.leadId}/summary` as const

  return (
    <InvoicePdfStatusProvider invoiceId={invoice.id} initial={initialStatus}>
      <div className='grid gap-6 py-4'>
        {/* ── Post-issue send prompt (one-shot, dismissible) ──────────── */}
        <PostIssueSendBanner invoice={invoice} />

        {/* ── Operational hero band ──────────────────────────────────── */}
        <section className='bg-dark text-white rounded-xl px-7 py-6'>
          <div className='flex items-start justify-between gap-6 flex-wrap'>
            <div className='min-w-0'>
              <h2 className='text-3xl font-bold tracking-tight tabular-nums'>
                {formatInvoiceNumber(invoice)}
              </h2>
              <div className='mt-2 flex items-center gap-x-3 gap-y-1 text-base text-white/70 flex-wrap'>
                <Link
                  href={recipientHref as any}
                  className='font-medium text-white hover:underline underline-offset-2'
                >
                  {invoice.legalNameSnapshot.trim() || 'ללא שם'}
                </Link>
                <span className='text-white/40'>·</span>
                <span className='font-semibold text-white tabular-nums'>
                  {formatCurrency(invoice.totalAmount)}
                </span>
                {invoice.issuedAt && (
                  <>
                    <span className='text-white/40'>·</span>
                    <span className='tabular-nums'>{formatDate(invoice.issuedAt)}</span>
                  </>
                )}
              </div>
            </div>

            <InvoiceHeroActions invoice={invoice} />
          </div>
        </section>

        {/* ── Metadata strip ─────────────────────────────────────────── */}
        <div className='flex items-center gap-2 flex-wrap text-sm text-gray-500'>
          <span className='text-xs font-medium px-2 py-0.5 rounded bg-softy text-gray-700'>
            {documentKindLabel(invoice.kind)}
          </span>
          <DocStateChip state={invoice.docState} />
          <FulfillStateChip state={invoice.fulfillState} />
          <InvoicePdfStatusChipLive />
          {invoice.issuedAt && (
            <span className='ms-2'>הונפקה ב-{formatDate(invoice.issuedAt)}</span>
          )}
          <InvoicePdfErrorReasonLive />
        </div>

      {/* ── Recipient (calm horizontal strip, not a bordered card) ── */}
      <section className='border-b border-gray-200 pb-5'>
        <p className='text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 mb-2'>לכבוד (חתום במסמך)</p>
        <p className='text-lg font-semibold text-gray-900'>{invoice.legalNameSnapshot.trim() || '—'}</p>
        <div className='mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-base text-gray-600'>
          {invoice.taxIdSnapshot.trim() && <span>ע.מ / ח.פ: {invoice.taxIdSnapshot}</span>}
          {joinAddressSnapshot(invoice) && (
            <>
              <span className='text-gray-300'>·</span>
              <span>{joinAddressSnapshot(invoice)}</span>
            </>
          )}
          {invoice.emailSnapshot.trim() && (
            <>
              <span className='text-gray-300'>·</span>
              <span dir='ltr' className='tabular-nums'>
                {invoice.emailSnapshot}
              </span>
            </>
          )}
          {invoice.phoneSnapshot.trim() && (
            <>
              <span className='text-gray-300'>·</span>
              <span dir='ltr' className='tabular-nums'>
                {invoice.phoneSnapshot}
              </span>
            </>
          )}
        </div>
      </section>

      {/* ── Line items ──────────────────────────────────────────────── */}
      <section>
        <h3 className='font-semibold mb-3 text-lg text-gray-900'>פריטים</h3>
        <div className='border border-gray-200 rounded-xl bg-white overflow-x-auto shadow-sm'>
          <table className='w-full text-base'>
            <thead className='bg-gray-50/60 text-right text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 border-b border-gray-100'>
              <tr>
                <th className='px-4 py-3.5 font-semibold'>תיאור</th>
                <th className='px-3 py-3.5 font-semibold text-end'>כמות</th>
                <th className='px-3 py-3.5 font-semibold text-end'>מחיר יחידה</th>
                <th className='px-3 py-3.5 font-semibold text-end'>הנחה</th>
                <th className='px-3 py-3.5 font-semibold text-end'>סה"כ שורה</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className='border-t border-gray-100'>
                  <td className='px-4 py-3.5'>
                    <div className='font-medium text-gray-900'>{line.title}</div>
                    {line.description && <div className='text-sm text-gray-500 mt-0.5'>{line.description}</div>}
                  </td>
                  <td className='px-3 py-3.5 tabular-nums text-end'>{formatLineNum(line.quantity)}</td>
                  <td className='px-3 py-3.5 tabular-nums text-end'>{formatCurrency(line.unitPrice)}</td>
                  <td className='px-3 py-3.5 tabular-nums text-end'>{line.discount > 0 ? formatCurrency(line.discount) : '—'}</td>
                  <td className='px-3 py-3.5 tabular-nums font-bold text-end text-gray-900 text-lg'>{formatCurrency(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Totals summary ─────────────────────────────────────────── */}
      <section className='bg-gray-50 rounded-xl p-6'>
        <dl className='grid grid-cols-2 gap-y-2.5 text-base max-w-md ms-auto'>
          <dt className='text-gray-500'>סכום ביניים</dt>
          <dd className='tabular-nums text-end text-gray-900 font-medium'>{formatCurrency(invoice.subtotalAmount)}</dd>
          <dt className='text-gray-500'>מע"מ</dt>
          <dd className='tabular-nums text-end text-gray-900 font-medium'>{formatCurrency(invoice.taxAmount)}</dd>
          {invoice.roundingAmount !== 0 && (
            <>
              <dt className='text-gray-500'>עיגול</dt>
              <dd className='tabular-nums text-end text-gray-900 font-medium'>{formatCurrency(invoice.roundingAmount)}</dd>
            </>
          )}
          <dt className='font-semibold border-t border-gray-200 pt-3 mt-2 text-base text-gray-700'>סה"כ לתשלום</dt>
          <dd className='font-bold tabular-nums text-end border-t border-gray-200 pt-3 mt-2 text-2xl text-dark'>
            {formatCurrency(invoice.totalAmount)}
          </dd>
          {invoice.outstandingAmount != null && invoice.outstandingAmount > 0 && (
            <>
              <dt className='text-gray-500 pt-1'>יתרה לתשלום</dt>
              <dd className='tabular-nums text-end pt-1 font-medium text-gray-900'>{formatCurrency(invoice.outstandingAmount)}</dd>
            </>
          )}
        </dl>
      </section>

      {invoice.kind === 'invoice_receipt' && invoice.paymentReceived && (
        <section className='border border-gray-200 rounded-xl p-5 bg-white'>
          <p className='text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 mb-3'>
            פרטי תשלום שהתקבל (חתום במסמך)
          </p>
          <dl className='grid grid-cols-2 gap-y-1.5 gap-x-6 text-base max-w-md'>
            <dt className='text-gray-500'>אמצעי תשלום</dt>
            <dd className='text-gray-900 font-medium text-end'>
              {paymentMethodLabel(invoice.paymentMethodSnapshot) || invoice.paymentMethodSnapshot || '—'}
            </dd>
            <dt className='text-gray-500'>סכום</dt>
            <dd className='tabular-nums text-gray-900 font-medium text-end'>
              {invoice.paymentAmountSnapshot != null ? formatCurrency(invoice.paymentAmountSnapshot) : '—'}
            </dd>
            <dt className='text-gray-500'>תאריך תשלום</dt>
            <dd className='tabular-nums text-gray-900 font-medium text-end'>
              {invoice.paymentDateSnapshot ? formatDate(invoice.paymentDateSnapshot) : '—'}
            </dd>
          </dl>
        </section>
      )}

      {invoice.customerFooter && (
        <section>
          <p className='text-xs font-semibold uppercase tracking-[0.08em] text-gray-500 mb-2'>הערה ללקוח</p>
          <p className='text-base whitespace-pre-line text-gray-700'>{invoice.customerFooter}</p>
        </section>
      )}

      {/* ── Timeline ───────────────────────────────────────────────── */}
      <section>
        <h3 className='font-semibold mb-3 text-lg text-gray-900'>פעילות</h3>
        <Suspense fallback={<TimelineSkeleton />}>
          <InvoiceTimelineList invoiceId={invoice.id} kind={invoice.kind} />
        </Suspense>
      </section>
      </div>
    </InvoicePdfStatusProvider>
  )
}

function joinAddressSnapshot(invoice: BillInvoiceRow): string {
  return [invoice.addressSnapshot, invoice.citySnapshot, invoice.zipSnapshot].filter(Boolean).join(', ')
}

function formatLineNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function toInitialStatus(invoice: BillInvoiceRow, document: BillDocumentRow | null): InvoicePdfStatusSnapshot {
  if (invoice.docState === 'draft') return { status: 'none', url: null, errorReason: null }
  if (!document) return { status: 'none', url: null, errorReason: null }
  if (document.status === 'ready' && document.isCurrent) return { status: 'ready', url: document.url, errorReason: null }
  if (document.status === 'failed') return { status: 'failed', url: null, errorReason: document.errorReason }
  return { status: 'rendering', url: null, errorReason: null }
}

function TimelineSkeleton() {
  return (
    <div className='border rounded-md bg-white py-8 text-center text-gray-400 text-sm'>טוען היסטוריה…</div>
  )
}
