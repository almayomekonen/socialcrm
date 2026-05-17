import { listInvoiceEvents, type BillFinancialEventRow } from '@/db/billing/events'
import { formatDateTime } from '@/lib/dates'
import { formatCurrency } from '@/lib/funcs'
import { paymentMethodLabel } from '@/lib/billing/payment/methods'
import { formatDocumentIdentity } from '@/lib/billing/numbering'
import type { DocumentKind } from '@/db/billing/invoices'

export default async function InvoiceTimelineList({
  invoiceId,
  kind,
}: {
  invoiceId: number
  kind: DocumentKind
}) {
  const events = await listInvoiceEvents({ invoiceId, limit: 50 })

  if (events.length === 0) {
    return (
      <div className='border rounded-md bg-white text-center py-8 text-gray-500'>
        <p className='text-sm'>אין פעילות מתועדת עדיין</p>
      </div>
    )
  }

  return (
    <ol className='border rounded-md bg-white divide-y'>
      {events.map((event) => (
        <li key={event.id} className='px-3 py-2 flex items-start gap-3'>
          <div className='flex-1'>
            <p className='text-sm'>{summarize(event, kind)}</p>
          </div>
          <time className='text-xs text-gray-500 tabular-nums whitespace-nowrap'>
            {formatDateTime(event.occurredAt)}
          </time>
        </li>
      ))}
    </ol>
  )
}

function summarize(event: BillFinancialEventRow, kind: DocumentKind): string {
  switch (event.eventType) {
    case 'invoice.drafted':
      return 'נוצרה טיוטה'
    case 'invoice.updated':
      return 'הטיוטה עודכנה'
    case 'invoice.issued': {
      const total = readNumber(event.payload, 'totalAmount')
      const number = readNumber(event.payload, 'documentNumber')
      // Kind is immutable post-issue (frozen by the bill_invoices CHECK
      // constraint) — using the current invoice.kind for historical events
      // is safe and gives the timeline a coherent, branded identity even
      // for old rows that never stored `kind` in the payload.
      const identity =
        number != null
          ? formatDocumentIdentity({ documentNumber: number, docState: 'issued', kind })
          : ''
      const identityLabel = identity ? ` ${identity}` : ''
      const totalLabel = total != null ? ` · סכום ${formatCurrency(total)}` : ''
      return `הונפק${identityLabel}${totalLabel}`
    }
    case 'invoice.voided':
      return 'המסמך בוטל'
    case 'invoice.replaced':
      return 'המסמך הוחלף'
    case 'payment.received': {
      const amount = readNumber(event.payload, 'paymentAmount')
      const method = typeof event.payload.paymentMethod === 'string' ? event.payload.paymentMethod : ''
      const methodLabel = paymentMethodLabel(method)
      const amountLabel = amount != null ? ` · ${formatCurrency(amount)}` : ''
      const methodSuffix = methodLabel ? ` באמצעות ${methodLabel}` : ''
      return `התקבל תשלום${amountLabel}${methodSuffix}`
    }
    default:
      return event.eventType
  }
}

function readNumber(payload: Record<string, unknown>, key: string): number | null {
  const v = payload[key]
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
