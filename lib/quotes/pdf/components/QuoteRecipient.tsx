import { COLOR, LTR_RUN, SP, TRACKING, TYPE } from '@/lib/billing/pdf/html/styles'

/** The customer as frozen on the quote when it was created: snapshots only, and only what exists. */
export function QuoteRecipient({ name, phone, email, subject }: { name: string; phone: string; email: string; subject: string }) {
  const contact = [phone, email].map((s) => s.trim()).filter(Boolean).join(' · ')
  return (
    <section>
      <div style={{ fontSize: TYPE.label, color: COLOR.label, letterSpacing: TRACKING.caps, fontWeight: 600 }}>לכבוד</div>
      {name.trim() && <div style={{ marginTop: SP.sm, fontSize: TYPE.emph, fontWeight: 600, color: COLOR.ink, overflowWrap: 'anywhere' }}>{name.trim()}</div>}
      {contact && (
        <div style={{ marginTop: SP.xs, fontSize: TYPE.metadata, color: COLOR.body }}>
          <span style={LTR_RUN}>{contact}</span>
        </div>
      )}
      <div style={{ marginTop: SP.lg, fontSize: TYPE.body, color: COLOR.text, overflowWrap: 'anywhere' }}>
        <span style={{ color: COLOR.label }}>נושא:</span> <strong style={{ fontWeight: 600 }}>{subject}</strong>
      </div>
    </section>
  )
}
