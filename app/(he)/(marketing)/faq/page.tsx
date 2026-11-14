import { buildPageMetadata } from '@/lib/seo/metadata'
import { JsonLd } from '@/components/seo/JsonLd'
import { buildFAQSchema } from '@/components/seo/FAQ'
import { ThemeProvider } from '@/components/lumen/theme-provider'
import Navbar from '@/components/lumen/layout/navbar'
import Footer from '@/components/lumen/layout/footer'
import FAQSection from '@/components/lumen/sections/faq-section'
import { FAQ_ITEMS } from '@/components/lumen/sections/faqItems'
import { breadcrumbSchema } from '@/lib/seo/schemas'

export const metadata = buildPageMetadata({
  path: '/faq',
  title: 'שאלות נפוצות: ייבוא לידים, וואטסאפ ומחיר | SocialCRM',
  description:
    'ייבוא מאקסל, סטטוסים, רשימת היום, הרשאות צוות, וואטסאפ, טפסי לידים מפייסבוק ומחיר: תשובות ישירות על איך SocialCRM עובדת בפועל.',
  ogTitle: 'שאלות נפוצות | SocialCRM',
  ogDescription:
    'איך הלידים נכנסים, איך עובד החיבור לוואטסאפ, מה ה-AI עושה וכמה זה עולה.',
})

/**
 * `/faq` mirrors Lumen's own FAQ route: the same `FAQSection` that closes
 * `/`. (The testimonials marquee that followed it was removed: its quotes were
 * not from verified customers.) Shell is mounted here because
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
        <JsonLd
          data={breadcrumbSchema([
            { name: 'דף הבית', path: '/' },
            { name: 'שאלות נפוצות', path: '/faq' },
          ])}
        />
        <Navbar initialBannerVisible={false} />
        {/* This route owns the page <h1>; the homepage keeps its own. */}
        <FAQSection headingLevel='h1' />
        <Footer />
      </div>
    </ThemeProvider>
  )
}
