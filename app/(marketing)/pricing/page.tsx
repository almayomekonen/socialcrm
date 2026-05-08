import { buildPageMetadata } from '@/lib/seo/metadata'
import { MarketingNavbar } from '@/components/marketing/MarketingNavbar'
import PricingPageComponent from '@/components/ui/pricing-card'

export const metadata = buildPageMetadata({
  path: '/pricing',
  title: 'מחירים | SocialCRM — מערכת ניהול לידים',
  description:
    'תוכניות מחיר גמישות לניהול לידים מפייסבוק, אינסטגרם ווואטסאפ. התחל בחינם, שדרג כשתצמח. ללא התחייבות.',
  ogTitle: 'מחירים | SocialCRM',
  ogDescription: 'התחל בחינם. שדרג כשתצמח. נהל לידים מכל מקור במקום אחד.',
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
