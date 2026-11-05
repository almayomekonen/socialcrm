import type { BillInvoiceLineRow } from '@/db/billing/invoices'
import { COLOR, LTR_RUN, SP, TRACKING, TYPE } from '../styles'
import { formatMoney, formatQty } from '../../format'

// Line-items table. CSS `dir="rtl"` on <table> handles column reversal so
// "תיאור" is the rightmost (widest) column and "סה"כ" sits on the left.
//
// Visual rhythm: hairline header underline, no row borders by default,
// soft hairline only on transitions to keep the table calm.

export function LinesTable({ lines }: { lines: BillInvoiceLineRow[] }) {
  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: TYPE.body,
        color: COLOR.text,
      }}
    >
      <thead>
        <tr style={{ borderBottom: `1px solid ${COLOR.ruleFirm}` }}>
          <Th>תיאור</Th>
          <Th align='left'>כמות</Th>
          <Th align='left'>מחיר</Th>
          <Th align='left'>סה&quot;כ</Th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, i) => {
          const isLast = i === lines.length - 1
          return (
            <tr
              key={line.id}
              style={{
                breakInside: 'avoid',
                borderBottom: isLast ? 'none' : `1px solid ${COLOR.ruleSoft}`,
              }}
            >
              <td style={{ padding: `${SP.md} 0`, verticalAlign: 'top' }}>
                <div style={{ color: COLOR.text, fontWeight: 500 }}>{line.title}</div>
                {line.description?.trim() && (
                  <div
                    style={{
                      marginTop: SP.xs,
                      fontSize: TYPE.label,
                      color: COLOR.label,
                      lineHeight: 1.55,
                    }}
                  >
                    {line.description.trim()}
                  </div>
                )}
              </td>
              <Td>{formatQty(line.quantity)}</Td>
              <Td>{formatMoney(line.unitPrice)}</Td>
              <Td bold>{formatMoney(line.lineTotal)}</Td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Th({
  children,
  align = 'right',
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <th
      style={{
        padding: `0 0 ${SP.sm}`,
        textAlign: align,
        fontSize: TYPE.label,
        color: COLOR.label,
        fontWeight: 600,
        letterSpacing: TRACKING.caps,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </th>
  )
}

function Td({ children, bold }: { children: React.ReactNode; bold?: boolean }) {
  return (
    <td
      style={{
        padding: `${SP.md} ${SP.lg} ${SP.md} 0`,
        textAlign: 'left',
        verticalAlign: 'top',
        color: bold ? COLOR.ink : COLOR.body,
        fontWeight: bold ? 600 : 400,
        whiteSpace: 'nowrap',
        ...LTR_RUN,
      }}
    >
      {children}
    </td>
  )
}
