import type { ReactNode } from 'react'
import { COLOR, LTR_RUN, SP, TRACKING, TYPE } from '@/lib/billing/pdf/html/styles'
import { formatQty } from '@/lib/billing/pdf/format'
import { ils, unitIls } from '../format'

export type QuotePdfItem = {
  id: number | string
  title: string
  description: string | null
  quantity: number | string
  unitPrice: number | string
  discount: number | string
  lineSubtotal: number | string
  taxRatePercentSnapshot: number | string
}

/**
 * The quote's lines. Separate from the invoice's LinesTable because a quote has
 * a discount column and shows line amounts before VAT; the shared table stays
 * untouched so invoice PDFs cannot change. Same tokens, same rhythm.
 */
export function QuoteLinesTable({ items }: { items: readonly QuotePdfItem[] }) {
  const anyDiscount = items.some((i) => Number(i.discount) > 0)
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: TYPE.body, color: COLOR.text }}>
      <thead>
        <tr style={{ borderBottom: `1px solid ${COLOR.ruleFirm}` }}>
          <Th>תיאור</Th>
          <Th align='left'>כמות</Th>
          <Th align='left'>מחיר ליחידה</Th>
          {anyDiscount && <Th align='left'>הנחה</Th>}
          <Th align='left'>סה&quot;כ לפני מע&quot;מ</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => (
          <tr key={item.id} style={{ breakInside: 'avoid', borderBottom: i === items.length - 1 ? 'none' : `1px solid ${COLOR.ruleSoft}` }}>
            <td style={{ padding: `${SP.md} 0`, verticalAlign: 'top', overflowWrap: 'anywhere' }}>
              <div style={{ color: COLOR.text, fontWeight: 500 }}>{item.title}</div>
              {item.description?.trim() && <div style={{ marginTop: SP.xs, fontSize: TYPE.label, color: COLOR.label, lineHeight: 1.55 }}>{item.description.trim()}</div>}
            </td>
            <Td>{formatQty(item.quantity)}</Td>
            <Td>{unitIls(item.unitPrice)}</Td>
            {anyDiscount && <Td>{Number(item.discount) > 0 ? ils(item.discount) : ''}</Td>}
            <Td bold>{ils(item.lineSubtotal)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Th({ children, align = 'right' }: { children: ReactNode; align?: 'left' | 'right' }) {
  return <th style={{ padding: `0 0 ${SP.sm} ${align === 'left' ? 0 : SP.lg}`, textAlign: align, fontSize: TYPE.label, color: COLOR.label, fontWeight: 600, letterSpacing: TRACKING.caps, whiteSpace: 'nowrap' }}>{children}</th>
}

function Td({ children, bold }: { children: ReactNode; bold?: boolean }) {
  return <td style={{ padding: `${SP.md} ${SP.lg} ${SP.md} 0`, textAlign: 'left', verticalAlign: 'top', color: bold ? COLOR.ink : COLOR.body, fontWeight: bold ? 600 : 400, whiteSpace: 'nowrap', ...LTR_RUN }}>{children}</td>
}
