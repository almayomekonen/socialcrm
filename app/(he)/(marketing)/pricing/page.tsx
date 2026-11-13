import { buildPageMetadata } from '@/lib/seo/metadata'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildFAQSchema } from '@/components/seo/FAQ'
import { breadcrumbSchema } from '@/lib/seo/schemas'
import { ThemeProvider } from '@/components/lumen/theme-provider'
import Navbar from '@/components/lumen/layout/navbar'
import Footer from '@/components/lumen/layout/footer'
import Pricing from '@/components/lumen/sections/pricing'
import PricingTable from '@/components/lumen/sections/pricing-table'
import PricingExplainer from '@/components/lumen/sections/pricing-explainer'
import FAQSection from '@/components/lumen/sections/faq-section'
import { BILLING_FAQ, PRICING_PAGE_HERO, PRICING_PAGE_META } from '@/lib/marketing/copy/pricingPage'

export const metadata = buildPageMetadata({
  path: '/pricing',
  title: PRICING_PAGE_META.title,
  description: PRICING_PAGE_META.description,
  ogTitle: PRICING_PAGE_META.ogTitle,
})

/**
 * `/pricing`: the shared pricing cards and comparison table, then what only
 * this page says — why one price covers the whole team, and how billing,
 * cancellation and the end of the trial actually work (traced to the code in
 * `lib/marketing/copy/pricingPage.ts`). Before this it repeated the homepage
 * block word for word and was not indexed.
 *
 * The Lumen shell is mounted here rather than in the layout — `ShellChrome`
 * stands back for this route, as it does for `/`.
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
        <JsonLd data={buildFAQSchema([...BILLING_FAQ.items])} />
        <JsonLd
          data={breadcrumbSchema([
            { name: 'דף הבית', path: '/' },
            { name: 'מחירים', path: '/pricing' },
          ])}
        />
        <Navbar initialBannerVisible={false} />
        {/* This route owns the page <h1>; the homepage keeps its own. */}
        <Pricing headingLevel='h1' copy={PRICING_PAGE_HERO} />
        <PricingExplainer />
        <PricingTable />
        <FAQSection copy={BILLING_FAQ} />
        <Footer />
      </div>
    </ThemeProvider>
  )
}
