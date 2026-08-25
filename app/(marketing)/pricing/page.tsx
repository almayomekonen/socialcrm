import { buildPageMetadata } from '@/lib/seo/metadata'
import { ThemeProvider } from '@/components/lumen/theme-provider'
import Navbar from '@/components/lumen/layout/navbar'
import Footer from '@/components/lumen/layout/footer'
import Pricing from '@/components/lumen/sections/pricing'
import PricingTable from '@/components/lumen/sections/pricing-table'
import { PRICING, ANNUAL_MONTHLY_EQUIVALENT } from '@/lib/pricing'

export const metadata = buildPageMetadata({
  path: '/pricing',
  title: `מחירים | SocialCRM | ${PRICING.currency}${PRICING.monthly} לחודש`,
  description:
    `מתחילים בשבעה ימי התנסות עם כל המערכת, בלי כרטיס אשראי. אחר כך ${PRICING.currency}${PRICING.monthly} לחודש, או ${PRICING.currency}${PRICING.annual} לשנה (${PRICING.currency}${ANNUAL_MONTHLY_EQUIVALENT} לחודש). כל הלידים מפייסבוק, מאינסטגרם ומוואטסאפ במקום אחד, עם AI שמכיר כל ליד.`,
  ogTitle: `מחירים | SocialCRM`,
  ogDescription: `שבעה ימי התנסות מלאה בלי כרטיס אשראי, ואז ${PRICING.currency}${PRICING.monthly} לחודש.`,
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
        <Navbar initialBannerVisible={false} />
        {/* This route owns the page <h1>; the homepage keeps its own. */}
        <Pricing headingLevel='h1' />
        <PricingTable />
        <Footer />
      </div>
    </ThemeProvider>
  )
}
