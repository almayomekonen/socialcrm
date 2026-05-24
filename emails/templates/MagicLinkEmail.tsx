import { Button, Heading, Img, Section, Text } from '@react-email/components'
import { EmailLayout } from '../components/EmailLayout'

export type MagicLinkEmailProps = {
  magicUrl: string
  expiresInMinutes?: number
}

const LOGO_URL = 'https://placehold.co/300x90/4f46e5/ffffff/png?text=SocialCRM'

export default function MagicLinkEmail({ magicUrl, expiresInMinutes = 15 }: MagicLinkEmailProps) {
  return (
    <EmailLayout preview='הכניסה שלך למערכת SocialCRM במרחק לחיצה אחת'>
      <Section style={{ textAlign: 'center', marginBottom: '24px' }}>
        <Img
          src={LOGO_URL}
          alt='SocialCRM'
          width='140'
          height='42'
          style={{ display: 'block', margin: '0 auto' }}
        />
      </Section>

      <Heading
        dir='rtl'
        style={{
          margin: 0,
          textAlign: 'center',
          fontSize: '24px',
          fontWeight: 'bold',
          color: '#0f172a',
        }}
      >
        ברוך הבא ל-<span dir='ltr'>SocialCRM</span>
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
        הכניסה שלך למערכת במרחק לחיצה אחת
      </Text>

      <Section style={{ marginTop: '32px', textAlign: 'center' }}>
        <Button
          href={magicUrl}
          style={{
            display: 'inline-block',
            backgroundColor: '#4f46e5',
            backgroundImage: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
            color: '#ffffff',
            fontSize: '16px',
            fontWeight: 'bold',
            textDecoration: 'none',
            padding: '14px 36px',
            borderRadius: '12px',
            textAlign: 'center',
          }}
        >
          התחבר למערכת
        </Button>
      </Section>

      <Text
        dir='rtl'
        style={{
          marginTop: '16px',
          marginBottom: 0,
          textAlign: 'center',
          fontSize: '13px',
          color: '#64748b',
        }}
      >
        הלינק תקף ל-{expiresInMinutes} דקות
      </Text>

      <Text
        dir='rtl'
        style={{
          marginTop: '32px',
          marginBottom: '8px',
          textAlign: 'right',
          fontSize: '12px',
          lineHeight: '1.5',
          color: '#64748b',
        }}
      >
        אם הכפתור לא עובד, ניתן להעתיק את הקישור הבא:
      </Text>

      <Section
        style={{
          backgroundColor: '#f1f5f9',
          borderRadius: '8px',
          padding: '12px 14px',
          border: '1px solid #e2e8f0',
        }}
      >
        <Text
          dir='ltr'
          style={{
            margin: 0,
            fontSize: '12px',
            lineHeight: '1.6',
            color: '#334155',
            wordBreak: 'break-all',
            fontFamily: 'Menlo, Consolas, monospace',
          }}
        >
          {magicUrl}
        </Text>
      </Section>

      <Text
        dir='rtl'
        style={{
          marginTop: '24px',
          marginBottom: 0,
          textAlign: 'center',
          fontSize: '12px',
          lineHeight: '1.6',
          color: '#94a3b8',
        }}
      >
        אם לא ביקשת להתחבר ניתן להתעלם מהודעה זו
      </Text>
    </EmailLayout>
  )
}
