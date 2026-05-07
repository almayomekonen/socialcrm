import { Metadata } from 'next'
import { MarketingNavbar } from '@/components/marketing/MarketingNavbar'
import PricingPageComponent from '@/components/ui/pricing-card'

export const metadata: Metadata = {
  title: 'מחירים | SocialCRM — מערכת ניהול לידים',
  description:
    'תוכניות מחיר גמישות לניהול לידים מפייסבוק, אינסטגרם ווואטסאפ. התחל בחינם, שדרג כשתצמח. ללא התחייבות.',
  alternates: { canonical: 'https://getsocialcrm.com/pricing' },
  openGraph: {
    title: 'מחירים | SocialCRM',
    description: 'התחל בחינם. שדרג כשתצמח. נהל לידים מכל מקור במקום אחד.',
    url: 'https://getsocialcrm.com/pricing',
  },
}

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
