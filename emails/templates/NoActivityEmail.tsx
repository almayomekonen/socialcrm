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
      preview='לידים חדשים ממשיכים להיכנס בזמן שאתה בחוץ'
      headline='הלידים שלך ממשיכים להגיע'
      opening={name ? `${name}, לא ראינו אותך כבר כמה ימים.` : 'לא ראינו אותך כבר כמה ימים.'}
      value='בזמן הזה לידים חדשים ממשיכים להיכנס ולחכות. כל יום שעובר בלי מענה הוא לקוח פוטנציאלי שעלול לבחור במישהו אחר.'
      action='כמה דקות במערכת יחזירו אותך לשליטה ויראו לך בדיוק למי כדאי לפנות היום.'
      ctaLabel='חזרה למערכת'
      ctaUrl={ctaUrl}
      unsubscribeUrl={unsubscribeUrl}
    />
  )
}
