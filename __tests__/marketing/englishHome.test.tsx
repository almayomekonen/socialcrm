// @vitest-environment jsdom
/**
 * The English homepage at `/en` (SEO L2).
 *
 * Hebrew and English are the only marketing languages, and the homepage is the
 * only page in both. The honesty rules of the Hebrew site apply here too, plus
 * two of its own: the page must say the app is in Hebrew, and must not promise
 * availability or card acceptance anywhere. What a visitor gets is what is
 * rendered, so the checks run on the rendered page.
 */

import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { cleanup } from '@testing-library/react'
import { renderPage, structuredData, norm } from './harness'
import { MARKETING_ROUTES, SITE_URL } from './routes'
import { EN, EN_LANGUAGE_NOTE, EN_TRIAL_CTA_LABEL, EN_TRIAL_OFFER_FAQ_ANSWER } from '@/lib/marketing/copy/en'
import { PRICING } from '@/lib/pricing'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {}, back: () => {}, forward: () => {}, refresh: () => {} }),
  usePathname: () => '/en',
  useSearchParams: () => new URLSearchParams(),
  redirect: () => {},
  notFound: () => {},
}))

import EnglishHomePage, { metadata } from '@/app/(en)/en/page'
import { metadata as hebrewHomeMetadata } from '@/app/(he)/(marketing)/page'
import sitemap from '@/app/sitemap'

const EXPECTED_ALTERNATES = {
  he: `${SITE_URL}/`,
  en: `${SITE_URL}/en`,
  'x-default': `${SITE_URL}/en`,
}

let container: HTMLElement
beforeEach(() => {
  container = renderPage(<EnglishHomePage />).container
})
afterEach(cleanup)

/** The page's own text: the Hebrew mockups are marked `lang="he"` and excluded. */
function englishText() {
  const copy = container.cloneNode(true) as HTMLElement
  copy.querySelectorAll('[lang="he"], script, style').forEach((node) => node.remove())
  return norm(copy.textContent)
}

describe('metadata', () => {
  test('canonical is /en with no trailing slash, and the page is indexable', () => {
    expect(metadata.alternates?.canonical).toBe(`${SITE_URL}/en`)
    expect(metadata.robots).toBeUndefined()
  })

  test('the Open Graph locale is English', () => {
    expect((metadata.openGraph as { locale?: string }).locale).toBe('en_US')
    expect((metadata.openGraph as { url?: string }).url).toBe(`${SITE_URL}/en`)
  })

  test('title and description are in English', () => {
    expect(String(metadata.title)).not.toMatch(/[֐-׿]/)
    expect(String(metadata.description)).not.toMatch(/[֐-׿]/)
  })
})

describe('hreflang', () => {
  test('/ and /en list exactly he, en and x-default, with x-default on /en', () => {
    expect(metadata.alternates?.languages).toEqual(EXPECTED_ALTERNATES)
    expect(hebrewHomeMetadata.alternates?.languages).toEqual(EXPECTED_ALTERNATES)
  })

  test('the Hebrew homepage canonical and Open Graph locale are unchanged', () => {
    expect(hebrewHomeMetadata.alternates?.canonical).toBe(`${SITE_URL}/`)
    expect((hebrewHomeMetadata.openGraph as { locale?: string }).locale).toBe('he_IL')
  })

  test('no other Hebrew marketing page declares alternates', () => {
    for (const route of MARKETING_ROUTES.filter((r) => r.dir)) {
      const source = readFileSync(`app/(he)/(marketing)/${route.dir}/page.tsx`, 'utf8')
      expect(source, route.path).not.toMatch(/HOME_LANGUAGES|languages:/)
    }
  })
})

describe('sitemap', () => {
  const entries = sitemap()
  const withAlternates = entries.filter((e) => e.alternates?.languages)

  test('only / and /en carry alternates, and they are the same three', () => {
    expect(withAlternates.map((e) => e.url).sort()).toEqual([`${SITE_URL}/`, `${SITE_URL}/en`])
    for (const entry of withAlternates) expect(entry.alternates?.languages).toEqual(EXPECTED_ALTERNATES)
  })

  test('nothing Arabic is listed', () => {
    expect(JSON.stringify(entries)).not.toMatch(/\/ar\b/)
    expect(entries.some((e) => /\/en\//.test(new URL(e.url).pathname))).toBe(false)
  })
})

describe('the rendered page', () => {
  test('has one main landmark and one h1', () => {
    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    expect(container.querySelector('main')?.id).toBe('main-content')
  })

  test('the page text has no Hebrew outside what is marked lang="he"', () => {
    expect(englishText()).not.toMatch(/[֐-׿]/)
  })

  test('the mockups and the published address are marked as Hebrew', () => {
    expect(container.querySelector('address')?.getAttribute('lang')).toBe('he')
    expect(container.querySelectorAll('[lang="he"]').length).toBeGreaterThan(2)
  })

  test('says the signed-in app is in Hebrew outside the authorized pilot', () => {
    expect(EN_LANGUAGE_NOTE).toMatch(/currently in Hebrew/)
    expect(EN_LANGUAGE_NOTE).toMatch(/authorized multilingual pilot/)
    expect(englishText()).toContain(EN_LANGUAGE_NOTE)
  })

  test('labels its sign-up buttons with the trial, and links them to sign-up', () => {
    const cta = [...container.querySelectorAll('a')].filter((a) => norm(a.textContent) === EN_TRIAL_CTA_LABEL)
    expect(cta.length).toBeGreaterThanOrEqual(2)
    for (const link of cta) expect(link.getAttribute('href')).toMatch(/^\/auth/)
  })

  test('links stay on /en, except the Hebrew legal pages, which say so', () => {
    const internal = [...container.querySelectorAll('a')]
      .filter((a) => !a.closest('[lang="he"]'))
      .map((a) => ({ href: a.getAttribute('href') ?? '', text: norm(a.textContent), hrefLang: a.getAttribute('hreflang') }))
      .filter((a) => a.href.startsWith('/') && !a.href.startsWith('/auth') && !a.href.startsWith('/api/'))
    for (const link of internal) {
      if (link.href === '/en' || link.href.startsWith('/en#')) continue
      expect(link.href, link.text).toMatch(/^\/(terms|privacy|data-deletion)$/)
      expect(link.text).toMatch(/\(Hebrew\)/)
      expect(link.hrefLang).toBe('he')
    }
    expect(internal.some((a) => a.href === '/ar' || a.href.startsWith('/ar/'))).toBe(false)
  })

  test('the navigation anchors exist on the page', () => {
    for (const id of ['features-carousel', 'features-grid', 'features-showcase', 'faq', 'pricing']) {
      expect(container.querySelector(`#${id}`), id).not.toBeNull()
    }
  })
})

describe('honesty', () => {
  const FORBIDDEN: Array<[label: string, pattern: RegExp]> = [
    ['"free" sign-up', /\bfree\b/i],
    ['"no credit card"', /no (credit )?card|without a (credit )?card/i],
    ['a promise of availability abroad', /\b(worldwide|global(ly)?|international(ly)?|anywhere|any country|every country)\b/i],
    ['a promise about cards from abroad', /\b(foreign|international|any) cards?\b/i],
    ['an English product', /\b(app|interface|system|CRM) (is )?(available )?in English\b/i],
    ['a testimonial', /\b(testimonial|trusted by|our customers say)\b/i],
    ['an unsourced number', /×\s*\d|\b\d+\s*(%|x\b)|\b\d[\d,]*\+/i],
  ]

  test.each(FORBIDDEN)('makes no claim of %s', (_label, pattern) => {
    expect(englishText()).not.toMatch(pattern)
    expect(JSON.stringify(EN)).not.toMatch(pattern)
  })

  test('states the real trial terms and the price in ILS, from the constants', () => {
    expect(EN_TRIAL_CTA_LABEL).toContain(String(TRIAL_LENGTH_DAYS))
    expect(EN_TRIAL_OFFER_FAQ_ANSWER).toContain(`${PRICING.currency}${PRICING.monthly} per month (ILS)`)
    expect(EN_TRIAL_OFFER_FAQ_ANSWER).toMatch(/save a credit card/)
    expect(EN_TRIAL_OFFER_FAQ_ANSWER).toContain(`${TRIAL_LENGTH_DAYS}-day trial`)
    expect(EN.pricing.plans.team.priceSuffix).toMatch(/ILS/)
    expect(EN.pricing.plans.individual.priceSuffix).toMatch(/ILS/)
    expect(englishText()).toMatch(/Israeli shekels \(ILS\)/)
  })

  test('no price or trial length is typed into the copy', () => {
    const source = readFileSync('lib/marketing/copy/en.ts', 'utf8')
    expect(source).not.toContain(`${PRICING.monthly}`)
    expect(source).not.toMatch(/\b7[- ]day/)
  })
})

describe('structured data', () => {
  const graphs = () => structuredData(container)
  const ofType = (type: string) => graphs().filter((g) => g['@type'] === type)

  test('the page and the site are English, the software is Hebrew and priced in ILS', () => {
    expect(ofType('WebSite')[0].inLanguage).toBe('en')
    expect(ofType('WebPage')[0].inLanguage).toBe('en')
    const software = ofType('SoftwareApplication')[0]
    expect(software.inLanguage).toBe('he')
    expect(software.offers).toMatchObject({ price: String(PRICING.monthly), priceCurrency: 'ILS' })
  })

  test('the FAQ schema is exactly the questions on the page', () => {
    const faq = ofType('FAQPage')[0].mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>
    expect(faq.map((q) => q.name)).toEqual(EN.faq.items.map((i) => i.question))
    for (const question of faq) expect(englishText()).toContain(question.name)
  })

  test('there is no HowTo: the page does not show those steps', () => {
    expect(ofType('HowTo')).toEqual([])
  })

  test('no structured data on the page is in Hebrew', () => {
    expect(JSON.stringify(graphs())).not.toMatch(/[֐-׿]/)
  })
})

describe('the Hebrew site stays free of English copy', () => {
  test('only the /en page imports the English copy', () => {
    const importers = execSync(`git grep -l "marketing/copy/en" -- app components lib`, { encoding: 'utf8' }).trim().split('\n')
    expect(importers).toEqual(['app/(en)/en/page.tsx'])
  })

  test('the Hebrew and English copy cover the same items', async () => {
    const { HE } = await import('@/lib/marketing/copy/he')
    expect(EN.featuresCarousel.items).toHaveLength(HE.featuresCarousel.items.length)
    expect(EN.featuresGrid.items).toHaveLength(HE.featuresGrid.items.length)
    expect(EN.featuresShowcase.items).toHaveLength(HE.featuresShowcase.items.length)
    expect(EN.nav.product.subitems).toHaveLength(HE.nav.product.subitems.length)
    expect(EN.pricing.plans.team.features).toHaveLength(HE.pricing.plans.team.features.length)
    expect(EN.pricing.plans.individual.features).toHaveLength(HE.pricing.plans.individual.features.length)
  })
})
