import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from '../components/EmailLayout'

export type TrialEndingEmailProps = {
  firstName: string | null
  ctaUrl: string
}

export default function TrialEndingEmail({ firstName, ctaUrl }: TrialEndingEmailProps) {
  return (
    <EmailLayout preview='תקופת הניסיון שלך מסתיימת בקרוב'>
      <Heading dir='rtl' style={{ margin: '8px 0 0 0', textAlign: 'center', fontSize: '22px', fontWeight: 'bold', color: '#0f172a' }}>
        תקופת הניסיון מסתיימת בקרוב
      </Heading>
      <Text dir='rtl' style={{ marginTop: '16px', textAlign: 'center', fontSize: '15px', lineHeight: '1.7', color: '#475569' }}>
        {firstName ? `היי ${firstName}, ` : ''}כדי להמשיך לנהל את הלידים שלך ללא הפרעה, אפשר לשדרג למנוי בכמה קליקים.
      </Text>
      <Section style={{ textAlign: 'center', margin: '28px 0' }}>
        <Button href={ctaUrl} style={{ backgroundColor: '#4f46e5', color: '#ffffff', borderRadius: '8px', padding: '12px 28px', fontSize: '15px', fontWeight: 'bold', textDecoration: 'none' }}>
          שדרג עכשיו
        </Button>
      </Section>
    </EmailLayout>
  )
}
