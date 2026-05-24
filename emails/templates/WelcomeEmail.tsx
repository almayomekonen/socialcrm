import { Button, Heading, Img, Section, Text } from '@react-email/components'
import { EmailLayout } from '../components/EmailLayout'

export type WelcomeEmailProps = {
  firstName: string
  ctaUrl: string
}

const LOGO_URL = 'https://placehold.co/300x90/4f46e5/ffffff/png?text=SocialCRM'

const BENEFITS = [
  'ניהול לידים במקום אחד',
  'מעקב אחר לקוחות ומשימות',
  'אוטומציות חכמות',
  'עבודה מהירה ופשוטה יותר',
]

const FIRST_STEPS = [
  'הוסף ליד ראשון',
  'ארגן את תהליך המכירה',
  'התחל לעבוד בצורה מסודרת',
]

export default function WelcomeEmail({ firstName, ctaUrl }: WelcomeEmailProps) {
  const greetingName = firstName?.trim()

  return (
    <EmailLayout preview='המערכת שלך מוכנה — אפשר להתחיל לנהל לידים ולסגור יותר עסקאות'>
      <Section style={{ textAlign: 'center', marginBottom: '8px' }}>
        <Img
          src={LOGO_URL}
          alt='SocialCRM'
          width='140'
          height='42'
          style={{ display: 'block', margin: '0 auto' }}
        />
      </Section>

      {greetingName && (
        <Text
          dir='rtl'
          style={{
            margin: '24px 0 0 0',
            textAlign: 'center',
            fontSize: '14px',
            color: '#64748b',
          }}
        >
          היי <bdi>{greetingName}</bdi> 👋
        </Text>
      )}

      <Heading
        dir='rtl'
        style={{
          margin: greetingName ? '8px 0 0 0' : '24px 0 0 0',
          textAlign: 'center',
          fontSize: '26px',
          fontWeight: 'bold',
          color: '#0f172a',
        }}
      >
        ברוך הבא ל-<span dir='ltr'>SocialCRM</span> 🎉
      </Heading>

      <Text
        dir='rtl'
        style={{
          marginTop: '12px',
          marginBottom: 0,
          textAlign: 'center',
          fontSize: '16px',
          lineHeight: '1.7',
          color: '#475569',
        }}
      >
        שמחים שהצטרפת.
        <br />
        המערכת שלך מוכנה ואתה יכול להתחיל לעבוד כבר עכשיו.
      </Text>

      <Section
        style={{
          marginTop: '28px',
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '20px 18px',
        }}
      >
        {BENEFITS.map((benefit) => (
          <Text
            key={benefit}
            dir='rtl'
            style={{
              margin: '0 0 8px 0',
              textAlign: 'right',
              fontSize: '15px',
              lineHeight: '1.6',
              color: '#0f172a',
            }}
          >
            <span style={{ color: '#4f46e5', fontWeight: 'bold', marginLeft: '8px' }}>✓</span>
            {benefit}
          </Text>
        ))}
      </Section>

      <Section style={{ marginTop: '32px', textAlign: 'center' }}>
        <Button
          href={ctaUrl}
          style={{
            display: 'inline-block',
            backgroundColor: '#4f46e5',
            backgroundImage: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
            color: '#ffffff',
            fontSize: '16px',
            fontWeight: 'bold',
            textDecoration: 'none',
            padding: '14px 40px',
            borderRadius: '12px',
            textAlign: 'center',
          }}
        >
          היכנס למערכת
        </Button>
      </Section>

      <Section style={{ marginTop: '36px' }}>
        <Text
          dir='rtl'
          style={{
            margin: '0 0 12px 0',
            textAlign: 'right',
            fontSize: '15px',
            fontWeight: 'bold',
            color: '#0f172a',
          }}
        >
          הצעדים הראשונים שלך:
        </Text>
        {FIRST_STEPS.map((step, idx) => (
          <Text
            key={step}
            dir='rtl'
            style={{
              margin: '0 0 6px 0',
              textAlign: 'right',
              fontSize: '14px',
              lineHeight: '1.6',
              color: '#334155',
            }}
          >
            <span style={{ color: '#4f46e5', fontWeight: 'bold', marginLeft: '8px' }}>{idx + 1}.</span>
            {step}
          </Text>
        ))}
      </Section>

      <Text
        dir='rtl'
        style={{
          marginTop: '32px',
          marginBottom: 0,
          textAlign: 'center',
          fontSize: '13px',
          lineHeight: '1.6',
          color: '#64748b',
        }}
      >
        יש שאלות? אנחנו כאן בשבילך
      </Text>
    </EmailLayout>
  )
}
