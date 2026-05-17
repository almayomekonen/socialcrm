import type { BillInvoiceRow } from '@/db/billing/invoices'
import { paymentMethodLabel } from '@/lib/billing/payment/methods'
import { COLOR, LTR_RUN, SP, TRACKING, TYPE } from '../styles'
import { formatMoney, formatPdfDate } from '../../format'

// Receipt summary for combined invoice/receipt documents. Visual language
// matches the totals panel for cohesion. Reads only the frozen *Snapshot
// columns — historical integrity invariant.

export function shouldRenderReceiptPanel(invoice: BillInvoiceRow): boolean {
  if (invoice.kind !== 'invoice_receipt') return false
  if (!invoice.paymentReceived) return false
  if (!invoice.paymentMethodSnapshot) return false
  return true
}

export function ReceiptPanel({ invoice }: { invoice: BillInvoiceRow }) {
  const methodLabel =
    paymentMethodLabel(invoice.paymentMethodSnapshot) || invoice.paymentMethodSnapshot
  const amount =
    invoice.paymentAmountSnapshot != null ? formatMoney(invoice.paymentAmountSnapshot) : ''
  const date = formatPdfDate(invoice.paymentDateSnapshot)

  return (
    <section
      style={{
        backgroundColor: COLOR.panel,
        padding: `${SP.lg} ${SP.xl}`,
        borderRadius: '8px',
        width: '280px',
        marginInlineStart: 'auto',
      }}
    >
      <div
        style={{
          fontSize: TYPE.label,
          color: COLOR.label,
          letterSpacing: TRACKING.caps,
          textTransform: 'uppercase',
          fontWeight: 600,
          paddingBottom: SP.md,
          marginBottom: SP.sm,
          borderBottom: `1px solid ${COLOR.ruleSoft}`,
        }}
      >
        קבלה — תשלום שהתקבל
      </div>
      <Row label='אמצעי תשלום' value={methodLabel} ltr={false} />
      <Row label='סכום' value={amount} ltr />
      <Row label='תאריך' value={date} ltr />
    </section>
  )
}

function Row({
  label,
  value,
  ltr,
}: {
  label: string
  value: string
  ltr: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: `${SP.xs} 0`,
        fontSize: TYPE.metadata,
      }}
    >
      <span style={{ color: COLOR.label }}>{label}</span>
      <span style={{ color: COLOR.body, ...(ltr ? LTR_RUN : {}) }}>{value}</span>
    </div>
  )
}
