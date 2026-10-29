import { listInvoiceEvents, type BillFinancialEventRow } from '@/db/billing/events'
import { formatCurrency } from '@/lib/funcs'
import type { DocumentKind } from '@/db/billing/invoices'
import type { UiLocale } from '@/lib/i18n/config'
import { translatorFor } from '@/lib/i18n/translators'
import type { Translator } from '@/lib/i18n/translate'
import { formatLeadDateTime } from '@/lib/leads/leadDate'
import { formatInvoiceNumber } from './funcs'
import { paymentMethodDisplay } from './labels'

/**
 * The issued view's activity list (async server component). Event sentences
 * are worded by event TYPE in `locale` (default Hebrew, the exact sentences it
 * always built); amounts keep `formatCurrency`, the document identity is
 * `formatInvoiceNumber` (Hebrew: `formatDocumentIdentity`), an unknown event
 * type is shown as stored.
 */
export default async function InvoiceTimelineList({
  invoiceId,
  kind,
  locale = 'he',
}: {
  invoiceId: number
  kind: DocumentKind
  locale?: UiLocale
}) {
  const t = translatorFor(locale)
  const events = await listInvoiceEvents({ invoiceId, limit: 50 })

  if (events.length === 0) {
    return (
      <div className='border rounded-md bg-white text-center py-8 text-gray-500'>
        <p className='text-sm'>{t('billing.issued.timeline.empty')}</p>
      </div>
    )
  }

  return (
    <ol className='border rounded-md bg-white divide-y'>
      {events.map((event) => (
        <li key={event.id} className='px-3 py-2 flex items-start gap-3'>
          <div className='flex-1'>
            <p className='text-sm'>{summarize(t, event, kind)}</p>
          </div>
          <time className='text-xs text-gray-500 tabular-nums whitespace-nowrap'>
            {formatLeadDateTime(locale, event.occurredAt)}
          </time>
        </li>
      ))}
    </ol>
  )
}

function summarize(t: Translator, event: BillFinancialEventRow, kind: DocumentKind): string {
  switch (event.eventType) {
    case 'invoice.drafted':
      return t('billing.issued.timeline.drafted')
    case 'invoice.updated':
      return t('billing.issued.timeline.updated')
    case 'invoice.issued': {
      const total = readNumber(event.payload, 'totalAmount')
      const number = readNumber(event.payload, 'documentNumber')
      // Kind is immutable post-issue (frozen by the bill_invoices CHECK
      // constraint) — using the current invoice.kind for historical events
      // is safe and gives the timeline a coherent, branded identity even
      // for old rows that never stored `kind` in the payload.
      const identity =
        number != null
          ? formatInvoiceNumber({ documentNumber: number, documentYear: null, docState: 'issued', kind }, t.locale)
          : ''
      const amount = total != null ? formatCurrency(total) : null
      if (identity && amount != null) return t('billing.issued.timeline.issuedIdentityTotal', { identity, amount })
      if (identity) return t('billing.issued.timeline.issuedIdentity', { identity })
      if (amount != null) return t('billing.issued.timeline.issuedTotal', { amount })
      return t('billing.issued.timeline.issued')
    }
    case 'invoice.voided':
      return t('billing.issued.timeline.voided')
    case 'invoice.replaced':
      return t('billing.issued.timeline.replaced')
    case 'payment.received': {
      const paid = readNumber(event.payload, 'paymentAmount')
      const method = typeof event.payload.paymentMethod === 'string' ? event.payload.paymentMethod : ''
      const methodLabel = paymentMethodDisplay(method, t.locale)
      const amount = paid != null ? formatCurrency(paid) : null
      if (amount != null && methodLabel) return t('billing.issued.timeline.paymentAmountMethod', { amount, method: methodLabel })
      if (amount != null) return t('billing.issued.timeline.paymentAmount', { amount })
      if (methodLabel) return t('billing.issued.timeline.paymentMethod', { method: methodLabel })
      return t('billing.issued.timeline.payment')
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
