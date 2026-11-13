import Link from 'next/link'
import type { Metadata } from 'next'
import { buildPageMetadata } from '@/lib/seo/metadata'
import { TRIAL_CTA_LABEL } from '@/lib/pricing'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'
import { JsonLd } from '@/components/seo/JsonLd'
import { breadcrumbSchema, webPageSchema } from '@/lib/seo/schemas'
import { MarketingLayout } from '@/components/seo/MarketingLayout'
import { FinalCTA } from '@/components/seo/CRMSections'
import { FAQ } from '@/components/ui/faq-tabs'
import { AnimatedCta } from '@/components/ui/animated-cta'
import { buildFAQSchema } from '@/components/seo/FAQ'
import { Btn } from '@/lib/btns/Btn'
import type { LandingPageContent } from '@/lib/marketing/landing/types'

/** Metadata for a landing page: self canonical, its own OG title and image. */
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
 * A Hebrew SEO landing page. The hero, the white prose sections, the tabbed
 * FAQ and the closing CTAs are the markup `/instagram-leads-crm` already uses;
 * this renders them from data so every landing page stays the same shape.
 *
 * Server Component: all text, including every FAQ answer, is in the HTML, and
 * the FAQPage schema is built from the same items the page shows.
 */
export function LandingPage({ page }: { page: LandingPageContent }) {
  const faqItems = [...page.faq.general, ...page.faq.setup]
  return (
    <>
      <JsonLd data={webPageSchema({ path: page.path, title: page.title, description: page.description })} />
      <JsonLd data={buildFAQSchema(faqItems)} />
      <JsonLd
        data={breadcrumbSchema([
          { name: 'דף הבית', path: '/' },
          { name: page.breadcrumb, path: page.path },
        ])}
      />

      <MarketingLayout>
        {/* Hero */}
        <div className='relative bg-blue-50 overflow-hidden font-sans pb-8 px-4'>
          <div>
            <div className='absolute inset-0 bg-linear-to-br from-transparent via-transparent to-blue-700 opacity-50 z-0' />
            <div className='absolute bottom-0 right-0 w-3/4 h-3/4 bg-blue-600 transform origin-bottom-right rotate-12 translate-y-1/3 -translate-x-1/4 opacity-90 z-0' />
            <div className='absolute bottom-0 left-0 w-1/2 h-1/2 bg-blue-700 opacity-80 z-0' />
            <div className='absolute top-0 left-0 w-1/2 h-full bg-blue-400 transform -skew-y-6 origin-top-left -translate-y-1/4 opacity-30 z-0' />
          </div>

          <div className='relative z-10 max-w-6xl mx-auto bg-white rounded-xl shadow-2xl overflow-hidden'>
            <div className='flex flex-col items-center text-center p-8 lg:px-12 lg:pt-8 lg:pb-16' dir='rtl'>
              <span
                className='inline-block px-3 py-1 rounded-full text-xs font-semibold mb-6 text-white'
                style={{ backgroundColor: '#3f20f5' }}
              >
                {page.badge}
              </span>
              <h1 className='text-4xl md:text-5xl font-bold text-gray-900 mb-6 leading-tight text-balance'>
                {page.h1[0]}
                <br />
                {page.h1[1]}
              </h1>
              {page.intro.map((p) => (
                <p key={p} className='text-lg text-gray-700 mb-4 max-w-2xl'>
                  {p}
                </p>
              ))}
              <div className='flex flex-col sm:flex-row items-center gap-4 mt-4'>
                <Link
                  href='/'
                  className='w-full sm:w-auto px-8 py-4 border border-gray-300 rounded-xl text-gray-800 font-bold hover:bg-gray-50 text-sm'
                >
                  לכל היכולות
                </Link>
                <Btn
                  href='/auth/register'
                  lbl={TRIAL_CTA_LABEL}
                  className='w-full sm:w-auto h-auto px-8 py-4 rounded-xl text-white font-bold hover:scale-105 transition-all text-sm'
                  style={{ backgroundColor: '#3f20f5' }}
                />
              </div>
              <p className='text-gray-500 text-sm mt-4'>
                {TRIAL_LENGTH_DAYS} ימים ללא חיוב. נדרש כרטיס אשראי. אפשר לבטל לפני החיוב הראשון.
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <article className='px-6 py-16 bg-white' dir='rtl'>
          <div className='max-w-3xl mx-auto space-y-14'>
            {page.sections.map((section) => (
              <section key={section.h2}>
                <h2 className='text-3xl font-bold mb-6 text-gray-900'>{section.h2}</h2>
                {section.paragraphs.map((p) => (
                  <p key={p} className='text-lg text-gray-700 mb-4 leading-relaxed'>
                    {p}
                  </p>
                ))}
                {section.bullets && (
                  <ul className='mt-2 space-y-3'>
                    {section.bullets.map((b) => (
                      <li key={b} className='flex items-start gap-3 text-lg text-gray-700 leading-relaxed'>
                        <span className='size-2 rounded-full mt-2.5 flex-none' style={{ backgroundColor: '#3f20f5' }} />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {section.links && (
                  <ul className='mt-6 flex flex-wrap gap-x-6 gap-y-2'>
                    {section.links.map((l) => (
                      <li key={l.href}>
                        <Link href={l.href} className='font-semibold underline underline-offset-4' style={{ color: '#3f20f5' }}>
                          {l.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </article>

        <AnimatedCta title={page.ctaTitle} highlight={page.ctaHighlight} buttonText={TRIAL_CTA_LABEL} buttonHref='/auth/register' />

        <FAQ
          title={page.faqTitle}
          subtitle='תשובות קצרות על איך זה עובד בפועל'
          categories={{ general: 'כללי', setup: 'התחלה ומחיר' }}
          faqData={{ general: [...page.faq.general], setup: [...page.faq.setup] }}
        />

        <FinalCTA />
      </MarketingLayout>
    </>
  )
}
