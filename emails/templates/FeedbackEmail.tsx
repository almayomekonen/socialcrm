import { Button, Heading, Section, Text } from '@react-email/components'
import { EmailLayout } from '../components/EmailLayout'

const LOGO_URL = 'https://getsocialcrm.com/media/og.png'

export type FeedbackEmailProps = {
  replyToEmail: string
  siteUrl: string
}

const QUESTIONS = [
  'מה אתה אוהב במערכת?',
  'מה לדעתך אפשר לשפר?',
  "אילו פיצ'רים היית רוצה לראות בעתיד?",
  'האם נתקלת בבעיה או משהו שלא עבד כפי שציפית?',
]

export default function FeedbackEmail({ replyToEmail, siteUrl }: FeedbackEmailProps) {
  return (
    <EmailLayout
      preview='נשמח לשמוע את דעתך על SocialCRM — כל פידבק עוזר לנו לבנות מוצר טוב יותר'
      logoUrl={LOGO_URL}
    >
      <Heading
        dir='rtl'
        style={{
          margin: '8px 0 0 0',
          textAlign: 'center',
          fontSize: '24px',
          fontWeight: 'bold',
          color: '#0f172a',
        }}
      >
        נשמח לשמוע את דעתך על <span dir='ltr'>SocialCRM</span> 💙
      </Heading>

      <Text
        dir='rtl'
        style={{
          marginTop: '20px',
          marginBottom: 0,
          textAlign: 'right',
          fontSize: '16px',
          lineHeight: '1.8',
          color: '#475569',
        }}
      >
        שלום,
        <br />
        <br />
        קודם כל תודה שבחרת להשתמש ב-<span dir='ltr'>SocialCRM</span>.
        <br />
        <br />
        אנחנו עובדים כל הזמן על שיפור המערכת, הוספת יכולות חדשות ושדרוג חוויית המשתמש, ולכן הפידבק שלך
        חשוב לנו מאוד.
      </Text>

      <Text
        dir='rtl'
        style={{
          margin: '24px 0 12px 0',
          textAlign: 'right',
          fontSize: '15px',
          fontWeight: 'bold',
          color: '#0f172a',
        }}
      >
        נשמח לשמוע:
      </Text>

      <Section
        style={{
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '20px 18px',
        }}
      >
        {QUESTIONS.map((question) => (
          <Text
            key={question}
            dir='rtl'
            style={{
              margin: '0 0 8px 0',
              textAlign: 'right',
              fontSize: '15px',
              lineHeight: '1.6',
              color: '#0f172a',
            }}
          >
            <span style={{ color: '#4f46e5', fontWeight: 'bold', marginLeft: '8px' }}>•</span>
            {question}
          </Text>
        ))}
      </Section>

      <Text
        dir='rtl'
        style={{
          marginTop: '24px',
          marginBottom: 0,
          textAlign: 'right',
          fontSize: '16px',
          lineHeight: '1.8',
          color: '#475569',
        }}
      >
        כל הערה, רעיון או הצעה יכולים לעזור לנו לבנות מוצר טוב יותר עבורך ועבור שאר המשתמשים.
        <br />
        <br />
        אפשר פשוט להשיב למייל הזה, ואנחנו נקרא כל הודעה באופן אישי.
      </Text>

      <Section style={{ marginTop: '28px', textAlign: 'center' }}>
        <Button
          href={`mailto:${replyToEmail}?subject=${encodeURIComponent('הפידבק שלי על SocialCRM')}`}
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
          השב עם הפידבק שלך
        </Button>
      </Section>

      <Text
        dir='rtl'
        style={{
          marginTop: '28px',
          marginBottom: 0,
          textAlign: 'right',
          fontSize: '16px',
          lineHeight: '1.8',
          color: '#475569',
        }}
      >
        כחברה בתחילת הדרך, כל פידבק עוזר לנו להבין מה באמת חשוב למשתמשים שלנו ולהמשיך לבנות את המערכת
        בכיוון הנכון. 💙
        <br />
        <br />
        תודה על הזמן ועל האמון ב-<span dir='ltr'>SocialCRM</span>.
        <br />
        <br />
        בברכה,
        <br />
        צוות <span dir='ltr'>SocialCRM</span>
      </Text>

      <Section style={{ marginTop: '24px', textAlign: 'center' }}>
        <a
          href={siteUrl}
          dir='ltr'
          style={{ fontSize: '14px', color: '#4f46e5', textDecoration: 'none', fontWeight: 'bold' }}
        >
          getsocialcrm.com
        </a>
      </Section>

      <Text
        dir='rtl'
        style={{
          marginTop: '20px',
          marginBottom: 0,
          textAlign: 'center',
          fontSize: '12px',
          lineHeight: '1.6',
          color: '#94a3b8',
        }}
      >
        אם אינך מעוניין/ת לקבל מאיתנו מיילים, השב/י למייל הזה עם המילה "הסר" ונסיר אותך מיד.
      </Text>
    </EmailLayout>
  )
}
