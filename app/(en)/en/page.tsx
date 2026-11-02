import { Suspense } from 'react'
import type { Metadata } from 'next'
import AttributionCapture from '@/components/analytics/AttributionCapture'
import SkipLink from '@/components/layout/SkipLink'
import Footer from '@/components/lumen/layout/footer'
import Navbar from '@/components/lumen/layout/navbar'
import FAQSection from '@/components/lumen/sections/faq-section'
import FeaturesCarousel from '@/components/lumen/sections/features-carousel'
import FeaturesGrid from '@/components/lumen/sections/features-grid'
import FeaturesShowcase from '@/components/lumen/sections/features-showcase'
import Hero from '@/components/lumen/sections/hero'
import Logos from '@/components/lumen/sections/logos'
import Pricing from '@/components/lumen/sections/pricing'
import { ThemeProvider } from '@/components/lumen/theme-provider'
import { buildFAQSchema } from '@/components/seo/FAQ'
import { JsonLd } from '@/components/seo/JsonLd'
import { EN, EN_META, EN_SCHEMA } from '@/lib/marketing/copy/en'
import { buildPageMetadata, HOME_LANGUAGES } from '@/lib/seo/metadata'
import { organizationSchema, softwareApplicationSchema, webPageSchema, websiteSchema } from '@/lib/seo/schemas'

export const metadata: Metadata = {
  ...buildPageMetadata({
    path: '/en',
    title: EN_META.title,
    description: EN_META.description,
    ogDescription: EN_META.ogDescription,
    locale: 'en_US',
    languages: HOME_LANGUAGES,
  }),
  icons: { icon: '/media/fav.svg', shortcut: '/media/fav.svg', apple: '/media/fav.svg' },
}

/**
 * `/en`: the same Lumen sections as `/`, with the copy in `lib/marketing/copy/en`.
 *
 * The product mockups stay in Hebrew because the product is in Hebrew, and the
 * software's structured data says so. The FAQ schema lists only the questions on
 * this page, so there is no HowTo node: nothing here shows those steps.
 */
export default function EnglishHomePage() {
  return (
    <div data-scroll-behavior='smooth' className='mkt-ground-light'>
      <JsonLd data={organizationSchema({ description: EN_SCHEMA.organizationDescription, inLanguage: 'en' })} />
      <JsonLd data={softwareApplicationSchema({ description: EN_SCHEMA.softwareDescription, featureList: EN_SCHEMA.featureList })} />
      <JsonLd data={websiteSchema({ description: EN_SCHEMA.websiteDescription, inLanguage: 'en' })} />
      <JsonLd data={webPageSchema({ path: '/en', title: EN_META.title, description: EN_META.description, inLanguage: 'en' })} />
      <JsonLd data={buildFAQSchema([...EN.faq.items])} />
      <AttributionCapture />
      <SkipLink label={EN_META.skipLink} />
      <Suspense>
        <main id='main-content' tabIndex={-1} className='focus:outline-none'>
          <ThemeProvider attribute='class' defaultTheme='light' enableSystem={false} disableTransitionOnChange>
            <div className='lumen' dir='ltr'>
              <Navbar initialBannerVisible={false} copy={EN.nav} />
              <Hero copy={EN.hero} />
              <Logos copy={EN.logos} />
              <FeaturesCarousel copy={EN.featuresCarousel} />
              <FeaturesGrid copy={EN.featuresGrid} />
              <FeaturesShowcase copy={EN.featuresShowcase} />
              <FAQSection copy={EN.faq} sectionId='faq' />
              <Pricing copy={EN.pricing} sectionId='pricing' />
              <Footer copy={EN.footer} />
            </div>
          </ThemeProvider>
        </main>
      </Suspense>
    </div>
  )
}
