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
      opening={name ? `${name}, בימים האחרונים כל הלידים שלך נוהלו במקום אחד מסודר.` : 'בימים האחרונים כל הלידים שלך נוהלו במקום אחד מסודר.'}
      value='עם סיום הניסיון תיסגר הגישה ללידים, למעקבים ולשיחות שכבר נבנו. שדרוג עכשיו שומר על הכל פעיל וממשיך לעבוד ללא הפרעה.'
      action='כמה קליקים היום, וכל מה שנבנה נשאר זמין.'
      ctaLabel='לשדרוג המנוי'
      ctaUrl={ctaUrl}
    />
  )
}
