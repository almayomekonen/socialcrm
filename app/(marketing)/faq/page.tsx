import { buildPageMetadata } from '@/lib/seo/metadata'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildFAQSchema } from '@/components/seo/FAQ'
import { ThemeProvider } from '@/components/lumen/theme-provider'
import Navbar from '@/components/lumen/layout/navbar'
import Footer from '@/components/lumen/layout/footer'
import FAQSection from '@/components/lumen/sections/faq-section'
import { FAQ_ITEMS } from '@/components/lumen/sections/faqItems'
import TestimonialsMarquee from '@/components/lumen/sections/testimonials-marquee'

export const metadata = buildPageMetadata({
  path: '/faq',
  title: 'שאלות נפוצות | SocialCRM',
  description:
    'התשובות לשאלות שחוזרות הכי הרבה: איך לידים מפייסבוק ומאינסטגרם נכנסים למערכת, איך עובד החיבור לוואטסאפ, מה ה-AI עושה בפועל, וכמה זה עולה.',
  ogTitle: 'שאלות נפוצות | SocialCRM',
  ogDescription:
    'איך הלידים נכנסים, איך עובד החיבור לוואטסאפ, מה ה-AI עושה וכמה זה עולה.',
})

/**
 * `/faq` mirrors Lumen's own FAQ route: the same `FAQSection` that closes
 * `/crm`, followed by the testimonials marquee. Shell is mounted here because
 * `ShellChrome` stands back for this route, as it does for the other Lumen pages.
 */
export default function FAQPage() {
  return (
    <ThemeProvider
      attribute='class'
      defaultTheme='light'
      enableSystem={false}
      disableTransitionOnChange
    >
      <div className='lumen min-h-screen' dir='rtl'>
        <JsonLd data={buildFAQSchema(FAQ_ITEMS)} />
        <Navbar initialBannerVisible={false} />
        {/* This route owns the page <h1>; the homepage keeps its own. */}
        <FAQSection headingLevel='h1' />
        <TestimonialsMarquee />
        <Footer />
      </div>
    </ThemeProvider>
  )
}
