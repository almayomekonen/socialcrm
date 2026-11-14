import type { Metadata } from 'next'

import Footer from '@/components/lumen/layout/footer'
import Navbar from '@/components/lumen/layout/navbar'
import FAQSection from '@/components/lumen/sections/faq-section'
import Hero from '@/components/lumen/sections/hero'
import LandingArticle from '@/components/lumen/sections/landing-article'
import LandingCta from '@/components/lumen/sections/landing-cta'
import { ThemeProvider } from '@/components/lumen/theme-provider'
import { buildFAQSchema } from '@/components/seo/FAQ'
import { JsonLd } from '@/components/seo/JsonLd'
import { HE } from '@/lib/marketing/copy/he'
import type { FaqSectionCopy } from '@/lib/marketing/copy/types'
import { LANDING_LINKS, TRIAL_TERMS_LINE, type LandingPageContent } from '@/lib/marketing/landing/types'
import { TRIAL_CTA_LABEL } from '@/lib/pricing'
import { buildPageMetadata } from '@/lib/seo/metadata'
import { breadcrumbSchema, webPageSchema } from '@/lib/seo/schemas'

/** Self canonical, its own OG title and 1200×630 image. */
export function landingMetadata(page: LandingPageContent): Metadata {
  return buildPageMetadata({
    path: page.path,
    title: page.title,
    description: page.description,
    ogTitle: page.ogTitle,
    ogImage: page.ogImage,
  })
}

/**
 * A Hebrew SEO landing page in the CURRENT design: the homepage's Lumen shell
 * (Navbar, Footer), its Hero (H1, intro, the same CTA; the trial terms in the
 * hero's note slot; no product screenshot) and its FAQSection (answers in the
 * HTML, closed on screen). Only the body and the closing CTA are new, and both
 * are built from the same Lumen primitives.
 *
 * The FAQPage schema is built from exactly the questions the FAQ section shows.
 */
export function LandingPage({ page }: { page: LandingPageContent }) {
  const faqItems = [...page.faq.general, ...page.faq.setup]
  const faqCopy: FaqSectionCopy = {
    ...HE.faq,
    title: page.faqTitle,
    items: faqItems.map((item, i) => ({ id: `lp-faq-${i + 1}`, ...item })),
    // The card under the questions has a CTA too, so it carries the trial terms.
    cardBodyBeforeDays: 'יש שאלה שלא מופיעה כאן? כתבו לנו ונחזור אליכם. אפשר גם להתחיל מיד: ',
    cardBodyAfterDays: ' ימים ללא חיוב. נדרש כרטיס אשראי.',
  }
  const related = LANDING_LINKS.filter((l) => l.href !== page.path)

  return (
    <ThemeProvider attribute='class' defaultTheme='light' enableSystem={false} disableTransitionOnChange>
      <div className='lumen' dir='rtl'>
        <JsonLd data={webPageSchema({ path: page.path, title: page.title, description: page.description })} />
        <JsonLd data={buildFAQSchema(faqItems)} />
        <JsonLd
          data={breadcrumbSchema([
            { name: 'דף הבית', path: '/' },
            { name: page.breadcrumb, path: page.path },
          ])}
        />
        <Navbar initialBannerVisible={false} />
        <Hero
          showImage={false}
          copy={{
            titleLine1: page.h1[0],
            titleLine2: ` ${page.h1[1]}`,
            subtitle: page.intro[0],
            cta: TRIAL_CTA_LABEL,
            imageAlt: '',
            languageNote: TRIAL_TERMS_LINE,
          }}
        />
        <LandingArticle lead={page.intro.slice(1)} sections={page.sections} related={related} />
        <FAQSection copy={faqCopy} />
        <LandingCta title={page.ctaTitle} highlight={page.ctaHighlight} />
        <Footer />
      </div>
    </ThemeProvider>
  )
}
