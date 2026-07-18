import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from '../components/EmailLayout'

export type FacebookNotConnectedEmailProps = {
  firstName: string | null
  ctaUrl: string
  unsubscribeUrl?: string
}

export default function FacebookNotConnectedEmail({ firstName, ctaUrl, unsubscribeUrl }: FacebookNotConnectedEmailProps) {
  return (
    <EmailLayout preview='חבר את פייסבוק כדי שלידים ייכנסו אוטומטית למערכת' unsubscribeUrl={unsubscribeUrl}>
      <Heading dir='rtl' style={{ margin: '8px 0 0 0', textAlign: 'center', fontSize: '22px', fontWeight: 'bold', color: '#0f172a' }}>
        חבר את פייסבוק
      </Heading>
      <Text dir='rtl' style={{ marginTop: '16px', textAlign: 'center', fontSize: '15px', lineHeight: '1.7', color: '#475569' }}>
        {firstName ? `היי ${firstName}, ` : ''}חיבור פייסבוק מאפשר ללידים מהמודעות שלך להיכנס אוטומטית למערכת — בלי להעתיק ידנית.
      </Text>
      <Section style={{ textAlign: 'center', margin: '28px 0' }}>
        <Button href={ctaUrl} style={{ backgroundColor: '#4f46e5', color: '#ffffff', borderRadius: '8px', padding: '12px 28px', fontSize: '15px', fontWeight: 'bold', textDecoration: 'none' }}>
          חבר פייסבוק
        </Button>
      </Section>
    </EmailLayout>
  )
}
