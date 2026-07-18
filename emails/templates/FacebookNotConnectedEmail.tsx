import { LifecycleEmail } from '../components/LifecycleEmail'

export type FacebookNotConnectedEmailProps = {
  firstName: string | null
  ctaUrl: string
  unsubscribeUrl?: string
}

export default function FacebookNotConnectedEmail({ firstName, ctaUrl, unsubscribeUrl }: FacebookNotConnectedEmailProps) {
  const name = firstName?.trim()
  return (
    <LifecycleEmail
      preview='כל ליד חדש מהמודעות שלך נכנס אוטומטית למערכת'
      headline='אף ליד לא צריך יותר ליפול בין הכיסאות'
      opening={name ? `${name}, רוב הלקוחות שלך מתחילים במודעה בפייסבוק.` : 'רוב הלקוחות שלך מתחילים במודעה בפייסבוק.'}
      value='כשפייסבוק מחובר, כל פנייה חדשה נכנסת ל SocialCRM ברגע שהיא מגיעה, עם כל הפרטים מסודרים במקום אחד. כך אתה מגיב ראשון, בדיוק כשהלקוח הכי מתעניין.'
      action='החיבור לוקח פחות מדקה, ומאותו רגע כל ליד חדש כבר מחכה לך במערכת.'
      ctaLabel='חבר את פייסבוק'
      ctaUrl={ctaUrl}
      unsubscribeUrl={unsubscribeUrl}
    />
  )
}
