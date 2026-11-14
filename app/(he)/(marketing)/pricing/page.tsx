import { buildPageMetadata } from '@/lib/seo/metadata'
import { JsonLd } from '@/components/seo/JsonLd'
import { breadcrumbSchema } from '@/lib/seo/schemas'
import { ThemeProvider } from '@/components/lumen/theme-provider'
import Navbar from '@/components/lumen/layout/navbar'
import Footer from '@/components/lumen/layout/footer'
import Pricing from '@/components/lumen/sections/pricing'
import PricingTable from '@/components/lumen/sections/pricing-table'
import { PRICING } from '@/lib/pricing'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'

export const metadata = buildPageMetadata({
  path: '/pricing',
  title: `מחיר מערכת CRM: ${PRICING.currency}${PRICING.monthly} לחודש לכל הצוות | SocialCRM`,
  description:
    `מחיר מערכת CRM של SocialCRM: ${PRICING.currency}${PRICING.monthly} לחודש לכל סביבת העבודה, בלי תוספת לכל נציג. ${TRIAL_LENGTH_DAYS} ימי ניסיון במערכת המלאה, בלי חיוב בתקופת הניסיון.`,
  ogTitle: `מחיר SocialCRM: ${PRICING.currency}${PRICING.monthly} לחודש לכל הצוות`,
  ogDescription: `${TRIAL_LENGTH_DAYS} ימי ניסיון במערכת המלאה ללא חיוב (נדרש כרטיס אשראי), ולאחר מכן ${PRICING.currency}${PRICING.monthly} לחודש.`,
})

/**
 * `/pricing` mirrors Lumen's own pricing route: the same `Pricing` section that
 * closes `/crm`, followed by the full feature-comparison table. The Lumen shell
 * (navbar + footer) is mounted here rather than in the layout — `ShellChrome`
 * stands back for this route, exactly as it does for `/crm`.
 */
export default function PricingPage() {
  return (
    <ThemeProvider
      attribute='class'
      defaultTheme='light'
      enableSystem={false}
      disableTransitionOnChange
    >
      <div className='lumen' dir='rtl'>
        <JsonLd
          data={breadcrumbSchema([
            { name: 'דף הבית', path: '/' },
            { name: 'מחירים', path: '/pricing' },
          ])}
        />
        <Navbar initialBannerVisible={false} />
        {/* This route owns the page <h1>; the homepage keeps its own. */}
        <Pricing headingLevel='h1' />
        <PricingTable />
        <Footer />
      </div>
    </ThemeProvider>
  )
}
