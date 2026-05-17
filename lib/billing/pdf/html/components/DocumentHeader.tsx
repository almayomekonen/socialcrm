import type { BillInvoiceRow } from '@/db/billing/invoices'
import type { IssuerData } from '@/lib/billing/issuer/fields'
import { documentLegalTitle } from '@/lib/billing/documentKinds'
import { formatDocumentShortNumber } from '@/lib/billing/numbering'
import { COLOR, LTR_RUN, SP, TRACKING, TYPE } from '../styles'
import { formatPdfDate } from '../../format'

// Top-of-document block. Two columns:
//   right (RTL "start"): document title + short number + issued date
//   left  (RTL "end"):   issuer logo or name + tax id, optional dates
//
// Browser handles RTL — no character reversal anywhere.

export function DocumentHeader({
  invoice,
  issuer,
  displayName,
  logoDataUri,
}: {
  invoice: BillInvoiceRow
  issuer: IssuerData | null
  displayName: string
  logoDataUri: string | null
}) {
  const shortNumber = formatDocumentShortNumber({
    documentNumber: invoice.documentNumber,
    docState: invoice.docState,
  })
  const issuedDate = formatPdfDate(invoice.issuedAt)
  const dueDate = formatPdfDate(invoice.dueAt)
  const taxId = issuer?.taxId?.trim() ?? ''

  return (
    <header
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: SP.xxl,
      }}
    >
      {/* Issuer (left of page in RTL). */}
      <IssuerCard
        displayName={displayName}
        taxId={taxId}
        logoDataUri={logoDataUri}
      />

      {/* Title + number + dates (right of page in RTL). */}
      <TitleColumn
        title={documentLegalTitle(invoice.kind)}
        shortNumber={shortNumber}
        issuedDate={issuedDate}
        dueDate={dueDate}
      />
    </header>
  )
}

function IssuerCard({
  displayName,
  taxId,
  logoDataUri,
}: {
  displayName: string
  taxId: string
  logoDataUri: string | null
}) {
  if (logoDataUri) {
    return (
      <div>
        <img
          src={logoDataUri}
          alt=''
          style={{ maxHeight: '38px', maxWidth: '160px', display: 'block' }}
        />
      </div>
    )
  }
  if (!displayName) return <div />

  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: TYPE.emph,
          fontWeight: 600,
          color: COLOR.text,
          letterSpacing: TRACKING.tight,
        }}
      >
        {displayName}
      </div>
      {taxId && (
        <div
          style={{
            marginTop: SP.xs,
            fontSize: TYPE.metadata,
            color: COLOR.label,
          }}
        >
          <span>ע.מ / ח.פ</span>{' '}
          <span style={LTR_RUN}>{taxId}</span>
        </div>
      )}
    </div>
  )
}

function TitleColumn({
  title,
  shortNumber,
  issuedDate,
  dueDate,
}: {
  title: string
  shortNumber: string
  issuedDate: string
  dueDate: string
}) {
  return (
    <div style={{ textAlign: 'left' }}>
      <h1
        style={{
          margin: 0,
          fontSize: TYPE.title,
          fontWeight: 600,
          color: COLOR.ink,
          letterSpacing: TRACKING.tight,
          lineHeight: 1.1,
        }}
      >
        {title}
      </h1>
      {shortNumber && (
        <div
          style={{
            marginTop: SP.sm,
            fontSize: TYPE.number,
            fontWeight: 600,
            color: COLOR.body,
            ...LTR_RUN,
            textAlign: 'left',
          }}
        >
          {shortNumber}
        </div>
      )}
      {(issuedDate || dueDate) && (
        <dl
          style={{
            margin: 0,
            marginTop: SP.lg,
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            columnGap: SP.md,
            rowGap: SP.xs,
            fontSize: TYPE.metadata,
          }}
        >
          {issuedDate && (
            <>
              <dt style={{ color: COLOR.label }}>הונפק</dt>
              <dd style={{ margin: 0, color: COLOR.body, ...LTR_RUN, textAlign: 'left' }}>
                {issuedDate}
              </dd>
            </>
          )}
          {dueDate && (
            <>
              <dt style={{ color: COLOR.label }}>פירעון</dt>
              <dd style={{ margin: 0, color: COLOR.body, ...LTR_RUN, textAlign: 'left' }}>
                {dueDate}
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  )
}
