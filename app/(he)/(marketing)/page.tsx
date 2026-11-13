import { buildPageMetadata, HOME_LANGUAGES } from '@/lib/seo/metadata'
import { PRICING } from '@/lib/pricing'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildFAQSchema } from '@/components/seo/FAQ'
import { FAQ_ITEMS } from '@/components/lumen/sections/faqItems'

import { ThemeProvider } from '@/components/lumen/theme-provider'
import Navbar from '@/components/lumen/layout/navbar'
import Footer from '@/components/lumen/layout/footer'
import Hero from '@/components/lumen/sections/hero'
import Logos from '@/components/lumen/sections/logos'
import FeaturesCarousel from '@/components/lumen/sections/features-carousel'
import FeaturesGrid from '@/components/lumen/sections/features-grid'
import FeaturesShowcase from '@/components/lumen/sections/features-showcase'
import FAQSection from '@/components/lumen/sections/faq-section'
import Pricing from '@/components/lumen/sections/pricing'

export const metadata = buildPageMetadata({
  path: '/',
  languages: HOME_LANGUAGES,
  title: 'מערכת CRM לעסקים קטנים עם וואטסאפ ו-AI | SocialCRM',
  description:
    `מערכת CRM בעברית לעסקים קטנים: כל הלידים מוואטסאפ, פייסבוק ואינסטגרם ברשימה אחת, עם סטטוס, נציג ומעקב. ${PRICING.currency}${PRICING.monthly} לחודש, ${TRIAL_LENGTH_DAYS} ימי ניסיון.`,
  ogTitle: 'מערכת CRM לעסקים קטנים | SocialCRM',
  ogDescription:
    'כל הלידים מפייסבוק, מאינסטגרם ומוואטסאפ במקום אחד, עם שיחה, סטטוס ומעקב לכל ליד, כדי ששום פנייה לא תיפול בין הכיסאות.',
})

/**
 * No SoftwareApplication node here on purpose.
 *
 * `softwareApplicationSchema()` in the marketing layout already emits one for
 * every marketing route, under `@id` `…/#software`. This page used to emit a
 * second node with that same `@id` (and `url: …/crm`), so the homepage shipped
 * two conflicting definitions of one entity and consumers merged them
 * arbitrarily. The layout's node is the authoritative one.
 *
 * No HowTo node either: the page does not show those steps, and `/en` dropped
 * its HowTo for the same reason.
 */
/**
 * Built from the questions the page actually shows (`FAQSection` renders
 * `FAQ_ITEMS`). It used to come from a separate list of nine questions that
 * never appeared on the page, so the structured data described content a
 * visitor could not see.
 */
const faqSchema = buildFAQSchema([...FAQ_ITEMS])

/**
 * `/` — the Lumen homepage, with SocialCRM content.
 *
 * Moved here from `/crm` unchanged; `/crm` is now a 308 to `/` (see
 * `next.config.mjs`). There is one homepage.
 *
 * Section order is Lumen's own
 * (`_reference/lumen-nextjs-template-1.0.0/src/app/page.tsx`), unchanged. The
 * components are Lumen's implementation; only the copy inside them is
 * SocialCRM's. Lumen's images, gradient, noise texture and motion are used
 * as shipped.
 *
 * `.lumen` scopes Lumen's design tokens so `bg-primary`, `bg-accent`,
 * `border-border` and `rounded-*` cannot reach the authenticated CRM, which
 * owns those utility names.
 */
export default function HomePage() {
  return (
    <ThemeProvider attribute='class' defaultTheme='light' enableSystem={false} disableTransitionOnChange>
    <div className='lumen' dir='rtl'>
      <JsonLd data={faqSchema} />

      <Navbar initialBannerVisible={false} />
      <Hero />
      <Logos />
      <FeaturesCarousel />
      <FeaturesGrid />
      <FeaturesShowcase />
      <FAQSection />
      <Pricing />
      <Footer />
    </div>
    </ThemeProvider>
  )
}
