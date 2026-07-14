import { buildPageMetadata } from '@/lib/seo/metadata'
import { MarketingNavbar } from '@/components/marketing/MarketingNavbar'
import PricingPageComponent from '@/components/ui/pricing-card'
import { PRICING } from '@/lib/pricing'

export const metadata = buildPageMetadata({
  path: '/pricing',
  title: 'מחירים | SocialCRM | CRM חינם עם שכבת AI אופרטיבית',
  description: `ה-CRM חינמי לתמיד וכולל ניהול לידים ללא הגבלה מפייסבוק, אינסטגרם ו-וואטסאפ. השדרוג ל-Pro פותח את שכבת ה-AI שמלווה כל ליד עם ניסוח הודעות, המלצות והיסטוריה תפעולית. ₪${PRICING.monthly} לסביבת עבודה הכוללת את כל הצוות.`,
  ogTitle: 'CRM חינמי עם שכבת AI אופרטיבית ב-Pro | SocialCRM',
  ogDescription: 'CRM מלא וחינמי לתמיד. שכבת AI אופרטיבית שזוכרת כל ליד זמינה ב-Pro.',
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
