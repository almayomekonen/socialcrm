import { COLOR, LTR_RUN, SP, TRACKING, TYPE } from '@/lib/billing/pdf/html/styles'
import { formatQty } from '@/lib/billing/pdf/format'
import { ils } from '../format'

/**
 * The stored totals, unchanged: nothing is computed here. `subtotal` is after
 * line discounts, which is how the quote stores it, so the label says so
 * whenever a discount exists.
 */
export function QuoteTotals({
  subtotal,
  discount,
  tax,
  total,
  ratePercent,
}: {
  subtotal: number | string
  discount: number | string
  tax: number | string
  total: number | string
  ratePercent: number | null
}) {
  const hasDiscount = Number(discount) > 0
  return (
    <section style={{ backgroundColor: COLOR.panel, padding: `${SP.lg} ${SP.xl}`, borderRadius: '8px', width: '300px', marginInlineStart: 'auto' }}>
      {hasDiscount && <Row label='הנחות' value={ils(discount)} />}
      <Row label={hasDiscount ? 'סכום לפני מע"מ (אחרי הנחות)' : 'סכום לפני מע"מ'} value={ils(subtotal)} />
      <Row label={ratePercent == null ? 'מע"מ' : `מע"מ (${formatQty(ratePercent)}%)`} value={ils(tax)} />
      <div style={{ marginTop: SP.md, paddingTop: SP.md, borderTop: `1px solid ${COLOR.ruleFirm}`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: TYPE.label, color: COLOR.label, fontWeight: 600, letterSpacing: TRACKING.caps }}>סה&quot;כ לתשלום</div>
        <div style={{ fontSize: TYPE.total, fontWeight: 600, color: COLOR.ink, letterSpacing: TRACKING.tight, ...LTR_RUN }}>{ils(total)}</div>
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: SP.md, padding: `${SP.xs} 0`, fontSize: TYPE.metadata }}>
      <span style={{ color: COLOR.label }}>{label}</span>
      <span style={{ color: COLOR.body, ...LTR_RUN }}>{value}</span>
    </div>
  )
}
