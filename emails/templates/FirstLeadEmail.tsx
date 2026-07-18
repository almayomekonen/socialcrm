import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from '../components/EmailLayout'

export type FirstLeadEmailProps = {
  firstName: string | null
  ctaUrl: string
  unsubscribeUrl?: string
}

export default function FirstLeadEmail({ firstName, ctaUrl, unsubscribeUrl }: FirstLeadEmailProps) {
  return (
    <EmailLayout preview='קיבלת את הליד הראשון שלך במערכת' unsubscribeUrl={unsubscribeUrl}>
      <Heading dir='rtl' style={{ margin: '8px 0 0 0', textAlign: 'center', fontSize: '22px', fontWeight: 'bold', color: '#0f172a' }}>
        קיבלת ליד ראשון
      </Heading>
      <Text dir='rtl' style={{ marginTop: '16px', textAlign: 'center', fontSize: '15px', lineHeight: '1.7', color: '#475569' }}>
        {firstName ? `${firstName}, ` : ''}הליד הראשון שלך נכנס למערכת. עכשיו זה הזמן לפנות אליו ולהתחיל לנהל את תהליך המכירה.
      </Text>
      <Section style={{ textAlign: 'center', margin: '28px 0' }}>
        <Button href={ctaUrl} style={{ backgroundColor: '#4f46e5', color: '#ffffff', borderRadius: '8px', padding: '12px 28px', fontSize: '15px', fontWeight: 'bold', textDecoration: 'none' }}>
          צפה בלידים
        </Button>
      </Section>
    </EmailLayout>
  )
}
