import { Heading, Text } from '@react-email/components'
import { EmailLayout } from '../components/EmailLayout'


export type InvoiceSentEmailProps = {
  recipientName: string
  documentIdentity: string
  shortNumber: string
  totalDisplay: string
  issuedDate: string
  agencyName: string
  customMessage?: string  
}

export default function InvoiceSentEmail({
  recipientName,
  documentIdentity,
  shortNumber,
  totalDisplay,
  issuedDate,
  agencyName,
  customMessage,
}: InvoiceSentEmailProps) {
  const safeName = recipientName?.trim() || 'שלום'

  return (
    <EmailLayout preview={`${documentIdentity} מ${agencyName}`}>
      <Heading
        dir='rtl'
        style={{
          margin: 0,
          textAlign: 'right',
          fontSize: '24px',
          fontWeight: 'bold',
          color: '#0f172a',
        }}
      >
        שלום <bdi>{safeName}</bdi>,
      </Heading>

      <Text
        dir='rtl'
        style={{
          marginTop: '16px',
          marginBottom: 0,
          textAlign: 'right',
          fontSize: '16px',
          lineHeight: '1.7',
          color: '#334155',
        }}
      >
        מצורף המסמך <bdi style={{ fontWeight: 600 }}>{shortNumber}</bdi> על סך{' '}
        <bdi style={{ fontWeight: 600 }}>{totalDisplay}</bdi>, מתאריך{' '}
        <bdi>{issuedDate}</bdi>.
      </Text>

      {customMessage?.trim() && (
        <Text
          dir='rtl'
          style={{
            marginTop: '16px',
            marginBottom: 0,
            textAlign: 'right',
            fontSize: '15px',
            lineHeight: '1.7',
            color: '#475569',
            whiteSpace: 'pre-line',
          }}
        >
          {customMessage}
        </Text>
      )}

      <Text
        dir='rtl'
        style={{
          marginTop: '32px',
          marginBottom: 0,
          textAlign: 'right',
          fontSize: '14px',
          lineHeight: '1.7',
          color: '#64748b',
        }}
      >
        תודה,
        <br />
        <bdi style={{ fontWeight: 600 }}>{agencyName}</bdi>
      </Text>
    </EmailLayout>
  )
}
