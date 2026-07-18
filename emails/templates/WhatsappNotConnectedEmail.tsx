import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from '../components/EmailLayout'

export type WhatsappNotConnectedEmailProps = {
  firstName: string | null
  ctaUrl: string
  unsubscribeUrl?: string
}

export default function WhatsappNotConnectedEmail({ firstName, ctaUrl }: WhatsappNotConnectedEmailProps) {
  return (
    <EmailLayout preview='חבר את וואטסאפ כדי לנהל את כל השיחות במקום אחד'>
      <Heading dir='rtl' style={{ margin: '8px 0 0 0', textAlign: 'center', fontSize: '22px', fontWeight: 'bold', color: '#0f172a' }}>
        חבר את וואטסאפ
      </Heading>
      <Text dir='rtl' style={{ marginTop: '16px', textAlign: 'center', fontSize: '15px', lineHeight: '1.7', color: '#475569' }}>
        {firstName ? `היי ${firstName}, ` : ''}חיבור וואטסאפ מרכז את כל שיחות הלידים בתיבה אחת, כדי ששום פנייה לא תיפול בין הכיסאות.
      </Text>
      <Section style={{ textAlign: 'center', margin: '28px 0' }}>
        <Button href={ctaUrl} style={{ backgroundColor: '#4f46e5', color: '#ffffff', borderRadius: '8px', padding: '12px 28px', fontSize: '15px', fontWeight: 'bold', textDecoration: 'none' }}>
          חבר וואטסאפ
        </Button>
      </Section>
    </EmailLayout>
  )
}
