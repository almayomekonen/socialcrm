import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from '../components/EmailLayout'

export type NoActivityEmailProps = {
  firstName: string | null
  ctaUrl: string
  unsubscribeUrl?: string
}

export default function NoActivityEmail({ firstName, ctaUrl, unsubscribeUrl }: NoActivityEmailProps) {
  return (
    <EmailLayout preview='הלידים שלך מחכים לך במערכת' unsubscribeUrl={unsubscribeUrl}>
      <Heading dir='rtl' style={{ margin: '8px 0 0 0', textAlign: 'center', fontSize: '22px', fontWeight: 'bold', color: '#0f172a' }}>
        הלידים שלך מחכים לך
      </Heading>
      <Text dir='rtl' style={{ marginTop: '16px', textAlign: 'center', fontSize: '15px', lineHeight: '1.7', color: '#475569' }}>
        {firstName ? `היי ${firstName}, ` : ''}לא ראינו אותך כבר כמה ימים. כמה דקות במערכת מספיקות כדי לחזור לעקוב אחרי הלידים ולא לפספס פניות.
      </Text>
      <Section style={{ textAlign: 'center', margin: '28px 0' }}>
        <Button href={ctaUrl} style={{ backgroundColor: '#4f46e5', color: '#ffffff', borderRadius: '8px', padding: '12px 28px', fontSize: '15px', fontWeight: 'bold', textDecoration: 'none' }}>
          חזרה למערכת
        </Button>
      </Section>
    </EmailLayout>
  )
}
