import { LifecycleEmail } from '../components/LifecycleEmail'

export type NoActivityEmailProps = {
  firstName: string | null
  ctaUrl: string
  unsubscribeUrl?: string
}

export default function NoActivityEmail({ firstName, ctaUrl, unsubscribeUrl }: NoActivityEmailProps) {
  const name = firstName?.trim()
  return (
    <LifecycleEmail
      preview='לידים חדשים ממשיכים להיכנס וממתינים למענה'
      headline='הלידים שלך ממשיכים להגיע'
      opening={name ? `${name}, עברו כמה ימים מאז הביקור האחרון במערכת.` : 'עברו כמה ימים מאז הביקור האחרון במערכת.'}
      value='בזמן הזה לידים חדשים ממשיכים להיכנס ולחכות. כל יום שעובר בלי מענה הוא לקוח פוטנציאלי שעלול לבחור במישהו אחר.'
      action='כמה דקות במערכת מספיקות כדי לחזור לשליטה ולראות בדיוק למי כדאי לפנות היום.'
      ctaLabel='חזרה למערכת'
      ctaUrl={ctaUrl}
      unsubscribeUrl={unsubscribeUrl}
    />
  )
}
