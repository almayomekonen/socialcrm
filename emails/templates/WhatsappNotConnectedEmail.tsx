import { LifecycleEmail } from '../components/LifecycleEmail'

export type WhatsappNotConnectedEmailProps = {
  firstName: string | null
  ctaUrl: string
  unsubscribeUrl?: string
}

export default function WhatsappNotConnectedEmail({ firstName, ctaUrl, unsubscribeUrl }: WhatsappNotConnectedEmailProps) {
  const name = firstName?.trim()
  return (
    <LifecycleEmail
      preview='כל שיחת וואטסאפ עם לקוח מסודרת במקום אחד'
      headline='כל שיחה עם לקוח, במקום אחד'
      opening={name ? `${name}, חלק גדול מהלקוחות שלך מעדיפים לכתוב בוואטסאפ.` : 'חלק גדול מהלקוחות שלך מעדיפים לכתוב בוואטסאפ.'}
      value='כשוואטסאפ מחובר, כל שיחה נכנסת ל SocialCRM לצד הליד שלה. אתה רואה את ההיסטוריה המלאה, יודע מי מחכה לתשובה, ולא מפספס אף הודעה בתוך עשרות צ׳אטים פתוחים.'
      action='דקה אחת של חיבור, ומעכשיו כל השיחות שלך מרוכזות ומסודרות.'
      ctaLabel='חבר את וואטסאפ'
      ctaUrl={ctaUrl}
      unsubscribeUrl={unsubscribeUrl}
    />
  )
}
