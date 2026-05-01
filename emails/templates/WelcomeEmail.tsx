import { Heading, Img, Section, Text } from '@react-email/components'
import { EmailLayout } from '../components/EmailLayout'
import { EmailButton } from '../components/EmailButton'

export type WelcomeEmailProps = {
  firstName: string
  ctaUrl: string
}

const LOGO_URL = 'https://placehold.co/300x90/4f46e5/ffffff/png?text=SocialCRM'

export default function WelcomeEmail({ firstName, ctaUrl }: WelcomeEmailProps) {
  const safeName = firstName?.trim() || 'שם'

  return (
    <EmailLayout preview={`ברוך הבא למערכת SocialCRM`}>
      
      <Section style={{ textAlign: 'center', marginBottom: '24px' }}>
        <Img
          src={LOGO_URL}
          alt="SocialCRM"
          width="140"
          height="42"
          style={{ display: 'block', margin: '0 auto' }}
        />
      </Section>

      <Heading
        dir="rtl"
        style={{
          margin: 0,
          textAlign: 'right',
          fontSize: '24px',
          fontWeight: 'bold',
          color: '#0f172a',
        }}
      >
        היי <bdi>{safeName}</bdi>,
      </Heading>

      <Text
        dir="rtl"
        style={{
          marginTop: '16px',
          marginBottom: 0,
          textAlign: 'right',
          fontSize: '16px',
          lineHeight: '1.7',
          color: '#334155',
        }}
      >
        ברוך הבא למערכת <span dir="ltr">SocialCRM</span>.
      </Text>

      <Text
        dir="rtl"
        style={{
          marginTop: '16px',
          marginBottom: 0,
          textAlign: 'right',
          fontSize: '16px',
          lineHeight: '1.7',
          color: '#334155',
        }}
      >
        מעכשיו כל הלידים שלך נמצאים במקום אחד, מסודרים וברורים.
      </Text>

      <Text
        dir="rtl"
        style={{
          marginTop: '16px',
          marginBottom: 0,
          textAlign: 'right',
          fontSize: '16px',
          lineHeight: '1.7',
          color: '#334155',
        }}
      >
        כל הפניות מפייסבוק, אינסטגרם וואטסאפ מתרכזות יחד, עם סטטוס מעודכן ומעקב מלא,
        כדי שתוכל להגיב מהר, לחזור לכל לקוח בזמן ולא לפספס אף הזדמנות.
      </Text>

      <Text
        dir="rtl"
        style={{
          marginTop: '16px',
          marginBottom: 0,
          textAlign: 'right',
          fontSize: '16px',
          lineHeight: '1.7',
          color: '#334155',
        }}
      >
        המערכת בנויה כדי לתת לך שליטה מלאה על תהליך המכירה, בפשטות ובמהירות.
      </Text>

      <Section style={{ marginTop: '32px', textAlign: 'right' }}>
        <EmailButton href={ctaUrl}>כניסה למערכת</EmailButton>
      </Section>

      <Text
        dir="rtl"
        style={{
          marginTop: '32px',
          marginBottom: '4px',
          textAlign: 'right',
          fontSize: '12px',
          lineHeight: '1.5',
          color: '#64748b',
        }}
      >
        אם הכפתור לא עובד, אפשר להעתיק את הקישור הבא לדפדפן:
      </Text>

      <Text
        dir="ltr"
        style={{
          margin: 0,
          textAlign: 'right',
          fontSize: '12px',
          lineHeight: '1.5',
          color: '#64748b',
          wordBreak: 'break-all',
        }}
      >
        {ctaUrl}
      </Text>
    </EmailLayout>
  )
}