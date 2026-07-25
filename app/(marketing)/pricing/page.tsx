import { buildPageMetadata } from '@/lib/seo/metadata'
import { MarketingNavbar } from '@/components/marketing/MarketingNavbar'
import PricingPageComponent from '@/components/ui/pricing-card'

export const metadata = buildPageMetadata({
  path: '/pricing',
  title: 'מחירים | SocialCRM | CRM חינם עם שכבת AI בתוכנית Pro',
  description:
    'המערכת חינמית וכוללת ניהול לידים מפייסבוק, מאינסטגרם ומוואטסאפ, עד חמישים לידים. תוכנית Pro מסירה את מגבלת הלידים ופותחת שכבת AI שמכירה כל ליד וממליצה מה לעשות.',
  ogTitle: 'CRM חינם עד חמישים לידים, AI מלא בתוכנית Pro | SocialCRM',
  ogDescription: 'המערכת חינמית עד חמישים לידים. תוכנית Pro מסירה את מגבלת הלידים ופותחת AI שמכיר כל ליד, מסכם את המצב וממליץ על הצעד הבא.',
})

export default function PricingPage() {
  return (
    <>
      <div className='bg-white'>
        <MarketingNavbar />
      </div>
      <PricingPageComponent />
    </>
  )
}
