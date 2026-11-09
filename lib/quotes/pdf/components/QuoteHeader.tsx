import type { IssuerData } from '@/lib/billing/issuer/fields'
import { COLOR, LTR_RUN, SP, TRACKING, TYPE } from '@/lib/billing/pdf/html/styles'

/** Issuer details (only those the agency has) and the quote's identity. Nothing is invented. */
export function QuoteHeader({
  issuer,
  displayName,
  quoteNumber,
  issuedDate,
  validUntil,
}: {
  issuer: IssuerData | null
  displayName: string
  quoteNumber: number | string
  issuedDate: string
  validUntil: string
}) {
  const taxId = issuer?.taxId?.trim() ?? ''
  const exempt = issuer?.businessType === 'exempt'
  const contact = [issuer?.address, issuer?.phone, issuer?.email].map((s) => s?.trim() ?? '').filter(Boolean)
  return (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: SP.xxl }}>
      <div style={{ minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: TYPE.title, fontWeight: 600, color: COLOR.ink, letterSpacing: TRACKING.tight, lineHeight: 1.1 }}>הצעת מחיר</h1>
        <div style={{ marginTop: SP.sm, fontSize: TYPE.number, fontWeight: 600, color: COLOR.body }}>
          מספר <span style={LTR_RUN}>{String(quoteNumber)}</span>
        </div>
        <div style={{ marginTop: SP.lg, fontSize: TYPE.metadata, color: COLOR.body, lineHeight: 1.7 }}>
          <Meta label='תאריך' value={issuedDate} />
          {validUntil && <Meta label='בתוקף עד' value={validUntil} />}
        </div>
      </div>
      {displayName && (
        <div style={{ minWidth: 0, textAlign: 'left' }}>
          <div style={{ fontSize: TYPE.emph, fontWeight: 600, color: COLOR.text, letterSpacing: TRACKING.tight, overflowWrap: 'anywhere' }}>{displayName}</div>
          <div style={{ marginTop: SP.xs, fontSize: TYPE.metadata, color: COLOR.label, lineHeight: 1.7 }}>
            {exempt && !taxId && <div>עוסק פטור</div>}
            {taxId && (
              <div>
                <span>{exempt ? 'עוסק פטור מס׳' : 'ע.מ / ח.פ'}</span> <span style={LTR_RUN}>{taxId}</span>
              </div>
            )}
            {contact.map((c) => (
              <div key={c} style={{ overflowWrap: 'anywhere' }}>
                {c}
              </div>
            ))}
          </div>
        </div>
      )}
    </header>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ color: COLOR.label }}>{label}</span> <span style={LTR_RUN}>{value}</span>
    </div>
  )
}
