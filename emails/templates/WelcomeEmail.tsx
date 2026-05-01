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
      <Section className="mb-6 text-center">
        <Img src={LOGO_URL} alt="SocialCRM" width="140" height="42" className="mx-auto block" />
      </Section>

      <Heading dir="rtl" className="m-0 text-right text-2xl font-bold text-slate-900">
        היי <bdi>{safeName}</bdi>,
      </Heading>

      <Text dir="rtl" className="mb-0 mt-4 text-right text-base leading-7 text-slate-700">
        ברוך הבא למערכת <span dir="ltr">SocialCRM</span>.
      </Text>

      <Text dir="rtl" className="mb-0 mt-4 text-right text-base leading-7 text-slate-700">
        מעכשיו כל הלידים שלך נמצאים במקום אחד, מסודרים וברורים.
      </Text>

      <Text dir="rtl" className="mb-0 mt-4 text-right text-base leading-7 text-slate-700">
        כל הפניות מפייסבוק, מאינסטגרם ומוואטסאפ מתרכזות יחד, עם סטטוס מעודכן ומעקב מלא,
        כדי שתוכל להגיב מהר, לחזור לכל לקוח בזמן ולא לפספס אף הזדמנות.
      </Text>

      <Text dir="rtl" className="mb-0 mt-4 text-right text-base leading-7 text-slate-700">
        המערכת בנויה כדי לתת לך שליטה מלאה על תהליך המכירה, בפשטות ובמהירות.
      </Text>

      <Section className="mt-8 text-right">
        <EmailButton href={ctaUrl}>כניסה למערכת</EmailButton>
      </Section>

      <Text dir="rtl" className="mt-8 mb-1 text-right text-xs leading-5 text-slate-500">
        אם הכפתור לא עובד, אפשר להעתיק את הקישור הבא לדפדפן.
      </Text>
      <Text
        dir="ltr"
        className="m-0 text-right text-xs leading-5 text-slate-500"
        style={{ unicodeBidi: 'isolate', wordBreak: 'break-all' }}
      >
        {ctaUrl}
      </Text>
    </EmailLayout>
  )
}