import type { BillInvoiceRow } from '@/db/billing/invoices'
import { COLOR, LTR_RUN, SP, TRACKING, TYPE } from '../styles'
import { formatMoney } from '../../format'

// Right-anchored totals panel (in RTL = visually left of page). Single
// strong line for the total; subtotal + VAT recede. Currency lives as a
// quiet footnote so the headline number stays clean.

export function TotalsPanel({ invoice }: { invoice: BillInvoiceRow }) {
  const hasRounding = Number(invoice.roundingAmount) !== 0

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
      <Row label='סכום ביניים' value={formatMoney(invoice.subtotalAmount)} />
      <Row label={'מע"מ'} value={formatMoney(invoice.taxAmount)} />
      {hasRounding && <Row label='עיגול' value={formatMoney(invoice.roundingAmount)} />}

      <div
        style={{
          marginTop: SP.md,
          paddingTop: SP.md,
          borderTop: `1px solid ${COLOR.ruleFirm}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <div
          style={{
            fontSize: TYPE.label,
            color: COLOR.label,
            fontWeight: 600,
            letterSpacing: TRACKING.caps,
            textTransform: 'uppercase',
          }}
        >
          סה&quot;כ
        </div>
        <div
          style={{
            fontSize: TYPE.total,
            fontWeight: 600,
            color: COLOR.ink,
            letterSpacing: TRACKING.tight,
            ...LTR_RUN,
          }}
        >
          {formatMoney(invoice.totalAmount)}
        </div>
      </div>

      <div
        style={{
          marginTop: SP.xs,
          textAlign: 'left',
          fontSize: TYPE.footnote,
          color: COLOR.mute,
          letterSpacing: TRACKING.caps,
        }}
      >
        {invoice.currency}
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
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
      <span style={{ color: COLOR.body, ...LTR_RUN }}>{value}</span>
    </div>
  )
}
