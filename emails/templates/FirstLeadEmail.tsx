import { LifecycleEmail } from '../components/LifecycleEmail'

export type FirstLeadEmailProps = {
  firstName: string | null
  ctaUrl: string
  unsubscribeUrl?: string
}

export default function FirstLeadEmail({ firstName, ctaUrl, unsubscribeUrl }: FirstLeadEmailProps) {
  const name = firstName?.trim()
  return (
    <LifecycleEmail
      preview='הליד הראשון שלך כבר במערכת ומחכה לתשובה'
      headline='הליד הראשון שלך הגיע'
      opening={name ? `${name}, זה הרגע שבו כל העבודה מתחילה להשתלם.` : 'זה הרגע שבו כל העבודה מתחילה להשתלם.'}
      value='הליד הראשון כבר במערכת ומחכה. לקוחות זוכרים את מי שענה ראשון, וכל דקה של מהירות מגדילה את הסיכוי לסגור.'
      action='אפשר להיכנס עכשיו, לראות את הפרטים, ולפנות ללקוח בזמן שהעניין עדיין חם.'
      ctaLabel='לצפייה בליד'
      ctaUrl={ctaUrl}
      unsubscribeUrl={unsubscribeUrl}
    />
  )
}
