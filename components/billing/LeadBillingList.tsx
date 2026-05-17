import Link from 'next/link'
import type { BillInvoiceRow } from '@/db/billing/invoices'
import { formatDate } from '@/lib/dates'
import { formatCurrency } from '@/lib/funcs'
import { docStateLabel, formatInvoiceNumber } from './funcs'
import { DocStateChip, FulfillStateChip } from './chips'
import CreateInvoiceBtn from './CreateInvoiceBtn'

export default function LeadBillingList({
  leadId,
  invoices,
  canCreate,
}: {
  leadId: number
  invoices: BillInvoiceRow[]
  canCreate: boolean
}) {
  return (
    <div className='py-4'>
      <div className='flex justify-between items-end mb-4'>
        <h2 className='text-xl font-semibold'>חיוב</h2>
        {canCreate && <CreateInvoiceBtn leadId={leadId} />}
      </div>

      {invoices.length === 0 ? (
        <EmptyState canCreate={canCreate} />
      ) : (
        <div className='border rounded-md bg-white overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-gray-50'>
              <tr className='text-right'>
                <th className='px-3 py-2 font-semibold'>מסמך</th>
                <th className='px-3 py-2 font-semibold'>סטטוס</th>
                <th className='px-3 py-2 font-semibold'>סכום</th>
                <th className='px-3 py-2 font-semibold'>תאריך הנפקה</th>
                <th className='px-3 py-2 font-semibold'>החזר עד</th>
                <th className='px-3 py-2'></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <InvoiceRow key={invoice.id} leadId={leadId} invoice={invoice} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function InvoiceRow({ leadId, invoice }: { leadId: number; invoice: BillInvoiceRow }) {
  const detailHref = `/clients/${leadId}/billing/${invoice.id}`
  const totalForDisplay = invoice.docState === 'draft' ? null : Number(invoice.totalAmount)

  return (
    <tr className='border-t'>
      <td className='px-3 py-2'>
        <Link href={detailHref} className='underline underline-offset-2 font-semibold'>
          {formatInvoiceNumber(invoice)}
        </Link>
      </td>
      <td className='px-3 py-2'>
        <div className='flex gap-1.5 flex-wrap'>
          <DocStateChip state={invoice.docState} />
          <FulfillStateChip state={invoice.fulfillState} />
        </div>
      </td>
      <td className='px-3 py-2'>
        {totalForDisplay == null ? <span className='text-gray-400'>—</span> : formatCurrency(totalForDisplay)}
      </td>
      <td className='px-3 py-2'>{invoice.issuedAt ? formatDate(invoice.issuedAt) : <span className='text-gray-400'>—</span>}</td>
      <td className='px-3 py-2'>{invoice.dueAt ? formatDate(invoice.dueAt) : <span className='text-gray-400'>—</span>}</td>
      <td className='px-3 py-2 text-end'>
        <Link href={detailHref} className='text-solid underline-offset-2 hover:underline'>
          {invoice.docState === 'draft' ? 'ערוך' : 'הצג'}
        </Link>
      </td>
    </tr>
  )
}

function EmptyState({ canCreate }: { canCreate: boolean }) {
  return (
    <div className='border border-dashed rounded-md bg-white text-center py-12 text-gray-500'>
      <p className='text-base mb-1'>אין חשבוניות לליד זה</p>
      <p className='text-sm'>
        {canCreate ? 'התחילו בהנפקת חשבונית ראשונה' : 'אין הרשאה להנפיק חשבוניות'}
      </p>
    </div>
  )
}

export { docStateLabel }
