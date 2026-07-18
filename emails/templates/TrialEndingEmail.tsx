import { LifecycleEmail } from '../components/LifecycleEmail'

export type TrialEndingEmailProps = {
  firstName: string | null
  ctaUrl: string
}

export default function TrialEndingEmail({ firstName, ctaUrl }: TrialEndingEmailProps) {
  const name = firstName?.trim()
  return (
    <LifecycleEmail
      preview='עוד כמה ימים והגישה ללידים שלך תיסגר'
      headline='תקופת הניסיון שלך עומדת להסתיים'
      opening={name ? `${name}, בימים האחרונים ניהלת את כל הלידים שלך במקום אחד מסודר.` : 'בימים האחרונים ניהלת את כל הלידים שלך במקום אחד מסודר.'}
      value='עם סיום הניסיון תיסגר הגישה ללידים, למעקבים ולשיחות שכבר בנית. שדרוג עכשיו שומר על הכל פעיל וממשיך לעבוד בשבילך בלי הפרעה.'
      action='כמה קליקים היום, וכל מה שבנית נשאר איתך.'
      ctaLabel='שדרג עכשיו'
      ctaUrl={ctaUrl}
    />
  )
}
