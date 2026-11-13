import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import AttributionCapture from '@/components/analytics/AttributionCapture'
import SkipLink from '@/components/layout/SkipLink'
import Footer from '@/components/lumen/layout/footer'
import Navbar from '@/components/lumen/layout/navbar'
import FAQSection from '@/components/lumen/sections/faq-section'
import { ThemeProvider } from '@/components/lumen/theme-provider'
import { Button } from '@/components/lumen/ui/button'
import { buildFAQSchema } from '@/components/seo/FAQ'
import { JsonLd } from '@/components/seo/JsonLd'
import { EN, EN_META, EN_TRIAL_CTA_LABEL, EN_TRIAL_TERMS } from '@/lib/marketing/copy/en'
import { SOCIAL_CRM_GUIDE, SOCIAL_CRM_GUIDE_FAQ, SOCIAL_CRM_GUIDE_META as META } from '@/lib/marketing/copy/socialCrmGuide'
import { buildPageMetadata } from '@/lib/seo/metadata'
import { breadcrumbSchema, webPageSchema } from '@/lib/seo/schemas'

/**
 * `/en/social-crm` — the English "social CRM" guide. No Hebrew twin, so no
 * hreflang: the canonical is the page itself and nothing else.
 */
export const metadata: Metadata = {
  ...buildPageMetadata({
    path: META.path,
    title: META.title,
    description: META.description,
    ogTitle: META.ogTitle,
    ogImage: META.ogImage,
    locale: 'en_US',
  }),
  icons: { icon: '/media/fav.svg', shortcut: '/media/fav.svg', apple: '/media/fav.svg' },
}

function TrialCta() {
  return (
    <div className='flex flex-col items-start gap-3'>
      <Button size='lg' asChild>
        <Link href='/auth/register'>{EN_TRIAL_CTA_LABEL}</Link>
      </Button>
      <p className='text-muted-foreground text-sm'>{EN_TRIAL_TERMS}</p>
    </div>
  )
}

export default function SocialCrmGuidePage() {
  return (
    <div data-scroll-behavior='smooth' className='mkt-ground-light'>
      <JsonLd data={webPageSchema({ path: META.path, title: META.title, description: META.description, inLanguage: 'en' })} />
      <JsonLd data={buildFAQSchema([...SOCIAL_CRM_GUIDE_FAQ.items])} />
      <JsonLd
        data={breadcrumbSchema([
          { name: 'SocialCRM', path: '/en' },
          { name: 'Social CRM guide', path: META.path },
        ])}
      />
      <AttributionCapture />
      <SkipLink label={EN_META.skipLink} />
      <Suspense>
        <main id='main-content' tabIndex={-1} className='focus:outline-none'>
          <ThemeProvider attribute='class' defaultTheme='light' enableSystem={false} disableTransitionOnChange>
            <div className='lumen' dir='ltr'>
              <Navbar initialBannerVisible={false} copy={EN.nav} />
              <article className='section-padding'>
                <div className='container max-w-3xl space-y-12'>
                  <header className='space-y-6'>
                    <h1 className='text-4xl leading-tight font-semibold tracking-tight lg:text-6xl'>{SOCIAL_CRM_GUIDE.h1}</h1>
                    {SOCIAL_CRM_GUIDE.intro.map((p) => (
                      <p key={p} className='text-muted-foreground text-lg leading-relaxed'>
                        {p}
                      </p>
                    ))}
                    <TrialCta />
                  </header>
                  {SOCIAL_CRM_GUIDE.sections.map((s) => (
                    <section key={s.h2} className='space-y-4'>
                      <h2 className='text-3xl leading-tight font-semibold tracking-tight lg:text-4xl'>{s.h2}</h2>
                      {s.paragraphs.map((p) => (
                        <p key={p} className='text-muted-foreground text-lg leading-relaxed'>
                          {p}
                        </p>
                      ))}
                      {s.bullets && (
                        <ul className='text-muted-foreground list-disc space-y-3 ps-6 text-lg leading-relaxed'>
                          {s.bullets.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      )}
                    </section>
                  ))}
                  <p className='text-lg'>
                    <Link href='/en' className='font-semibold underline underline-offset-4'>
                      See how SocialCRM manages leads from WhatsApp, Instagram and Facebook
                    </Link>
                  </p>
                  <TrialCta />
                </div>
              </article>
              <FAQSection copy={SOCIAL_CRM_GUIDE_FAQ} />
              <Footer copy={EN.footer} />
            </div>
          </ThemeProvider>
        </main>
      </Suspense>
    </div>
  )
}
