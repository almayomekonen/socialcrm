import type { BillInvoiceRow } from '@/db/billing/invoices'
import { COLOR, LTR_RUN, SP, TRACKING, TYPE } from '../styles'

// Frozen recipient snapshot. Strong name, calm metadata. Reads ONLY from
// the *Snapshot fields — the document is a projection of issuance-time
// truth, never live state.

export function RecipientBlock({ invoice }: { invoice: BillInvoiceRow }) {
  const legalName = invoice.legalNameSnapshot?.trim() ?? ''
  const taxId = invoice.taxIdSnapshot?.trim() ?? ''
  const address = [invoice.addressSnapshot, invoice.citySnapshot, invoice.zipSnapshot]
    .map((s) => s?.trim() ?? '')
    .filter(Boolean)
    .join(', ')
  const email = invoice.emailSnapshot?.trim() ?? ''
  const phone = invoice.phoneSnapshot?.trim() ?? ''
  const contact = [email, phone].filter(Boolean).join(' · ')

  const metaLines: Array<{ key: string; node: React.ReactNode }> = []
  if (taxId) {
    metaLines.push({
      key: 'taxid',
      node: (
        <>
          <span style={{ color: COLOR.label }}>ע.מ / ח.פ</span>{' '}
          <span style={LTR_RUN}>{taxId}</span>
        </>
      ),
    })
  }
  if (address) metaLines.push({ key: 'address', node: address })
  if (contact)
    metaLines.push({
      key: 'contact',
      node: <span style={LTR_RUN}>{contact}</span>,
    })

  return (
    <section>
      <div
        style={{
          fontSize: TYPE.label,
          color: COLOR.label,
          letterSpacing: TRACKING.caps,
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        לכבוד
      </div>
      {legalName && (
        <div
          style={{
            marginTop: SP.sm,
            fontSize: TYPE.emph,
            fontWeight: 600,
            color: COLOR.ink,
            letterSpacing: TRACKING.tight,
          }}
        >
          {legalName}
        </div>
      )}
      {metaLines.length > 0 && (
        <div
          style={{
            marginTop: SP.xs,
            fontSize: TYPE.metadata,
            color: COLOR.body,
            lineHeight: 1.7,
          }}
        >
          {metaLines.map((line) => (
            <div key={line.key}>{line.node}</div>
          ))}
        </div>
      )}
    </section>
  )
}
