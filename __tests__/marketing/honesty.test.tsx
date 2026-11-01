// @vitest-environment jsdom
/**
 * Honesty guardrail for the public marketing pages (SEO Phase 0).
 *
 * The site used to say "התחל בחינם" / "ללא כרטיס אשראי" while sign-up requires
 * a saved card before the CRM opens (lib/trial), showed named customer quotes
 * no customer had given, quoted "×3 more closed leads" with no source, and
 * told Google the product costs ₪0. Each of those reads fine in review on its
 * own, so the rendered text of every page is checked here instead.
 *
 * WHAT IS RENDERED IS WHAT A VISITOR GETS. Every route is rendered inside the
 * real marketing layout with `usePathname` set to that route, so `ShellFrame`
 * picks the same header and footer it picks in production (Lumen chrome for
 * the self-shelled and legal routes, `MarketingHeader`/`MarketingFooter` for
 * the SEO pages). The page list comes from the route table, and the route
 * table is checked against the proxy's public allowlist: a page that is not a
 * live public route cannot be tested here, and a live route cannot be missed.
 */

import { describe, test, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { existsSync, readFileSync } from 'node:fs'
import { cleanup } from '@testing-library/react'
import { renderPage, norm } from './harness'
import { INDEXABLE_ROUTES } from './routes'
import { PRICING, TRIAL_CTA_LABEL, TRIAL_OFFER_FAQ_ANSWER } from '@/lib/pricing'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'
import { softwareApplicationSchema } from '@/lib/seo/schemas'

const nav = vi.hoisted(() => ({ pathname: '/' }))

// Inline, not imported: `vi.mock` is hoisted above the import block.
vi.mock('@/actions/auth', () => ({ getSessionState: async () => false, logout: async () => {} }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {}, back: () => {}, forward: () => {}, refresh: () => {} }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  redirect: () => {},
  notFound: () => {},
}))

import MarketingLayout from '@/app/(he)/(marketing)/layout'
import Home from '@/app/(he)/(marketing)/page'
import Channels from '@/app/(he)/(marketing)/channels/page'
import Pricing from '@/app/(he)/(marketing)/pricing/page'
import Faq from '@/app/(he)/(marketing)/faq/page'
import InstagramLeads from '@/app/(he)/(marketing)/instagram-leads-crm/page'
import CrmForWhatsapp from '@/app/(he)/(marketing)/crm-for-whatsapp-business/page'
import CrmVsExcel from '@/app/(he)/(marketing)/crm-vs-excel/page'
import Privacy from '@/app/(he)/(marketing)/privacy/page'
import Terms from '@/app/(he)/(marketing)/terms/page'
import DataDeletion from '@/app/(he)/(marketing)/data-deletion/page'

afterEach(cleanup)

type Chrome = 'lumen' | 'seo'
type Scope = 'marketing' | 'legal'

/**
 * Every live public marketing route, the page module that serves it, the
 * chrome `ShellFrame` gives it, and whether its BODY is marketing copy. Legal
 * bodies are out of scope (their wording is not marketing copy); their chrome
 * is not, so the shell checks still run on them.
 */
const ROUTES: Record<string, { Page: () => React.ReactNode; chrome: Chrome; scope: Scope }> = {
  '/': { Page: Home, chrome: 'lumen', scope: 'marketing' },
  '/channels': { Page: Channels, chrome: 'lumen', scope: 'marketing' },
  '/pricing': { Page: Pricing, chrome: 'lumen', scope: 'marketing' },
  '/faq': { Page: Faq, chrome: 'lumen', scope: 'marketing' },
  '/instagram-leads-crm': { Page: InstagramLeads, chrome: 'seo', scope: 'marketing' },
  '/crm-for-whatsapp-business': { Page: CrmForWhatsapp, chrome: 'seo', scope: 'marketing' },
  '/crm-vs-excel': { Page: CrmVsExcel, chrome: 'seo', scope: 'marketing' },
  '/privacy': { Page: Privacy, chrome: 'lumen', scope: 'legal' },
  '/terms': { Page: Terms, chrome: 'lumen', scope: 'legal' },
  '/data-deletion': { Page: DataDeletion, chrome: 'lumen', scope: 'legal' },
}

/** The proxy's PUBLIC_ROUTES, read from source: the routes a signed-out visitor can actually open. */
function proxyPublicRoutes(): string[] {
  const src = readFileSync('proxy.ts', 'utf8')
  const block = src.match(/const PUBLIC_ROUTES = \[([\s\S]*?)\]/)?.[1] ?? ''
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

function renderRoute(path: string) {
  nav.pathname = path
  const { Page } = ROUTES[path]
  return renderPage(
    <MarketingLayout>
      <Page />
    </MarketingLayout>,
  )
}

describe('the tested pages are exactly the live public marketing routes', () => {
  test('this suite covers every indexable route in the route table, and nothing else', () => {
    expect(Object.keys(ROUTES).sort()).toEqual(INDEXABLE_ROUTES.map((r) => r.path).sort())
  })

  test('the route table matches the proxy allowlist (the retired /crm is a 308, not a page)', () => {
    const live = proxyPublicRoutes().filter((p) => p !== '/crm')
    expect(live.sort()).toEqual(Object.keys(ROUTES).sort())
  })

  test('every tested route is served by a page file under app/(he)/(marketing)', () => {
    for (const r of INDEXABLE_ROUTES) {
      const file = r.dir ? `app/(he)/(marketing)/${r.dir}/page.tsx` : 'app/(he)/(marketing)/page.tsx'
      expect(existsSync(file), `${r.path} → ${file}`).toBe(true)
    }
  })
})

/** Claims the verified sign-up flow contradicts, and numbers nothing measured. */
const FORBIDDEN: Array<[label: string, pattern: RegExp]> = [
  ['"free" sign-up', /בחינם|הרשמה חינמית|התוכנית החינמית/],
  ['"no credit card"', /ללא כרטיס|בלי כרטיס|לא דורשת? כרטיס|0\s*כרטיס אשראי/],
  ['unsourced multiplier', /×\s*3/],
]

/** The names the removed testimonial sections attributed quotes to. */
const TESTIMONIAL_NAMES = ['רועי כהן', 'מיכל לוי', 'שירה אבגי', 'יוני פרץ']

describe.each(Object.keys(ROUTES))('%s as rendered', (path) => {
  const { chrome, scope } = ROUTES[path]

  test(`renders inside the ${chrome === 'lumen' ? 'Lumen' : 'SEO'} chrome ShellFrame gives this route`, () => {
    const { container } = renderRoute(path)
    const seoHeader = container.querySelector('nav[aria-label="ניווט ראשי"]')
    const lumenChannelsLink = [...container.querySelectorAll('a[href="/channels"]')].some((a) => norm(a.textContent) === 'ערוצים')
    if (chrome === 'seo') expect(seoHeader, `${path} should have MarketingHeader`).not.toBeNull()
    else {
      expect(seoHeader, `${path} should not have MarketingHeader`).toBeNull()
      expect(lumenChannelsLink, `${path} should have the Lumen navbar`).toBe(true)
    }
    expect(container.querySelectorAll('main#main-content')).toHaveLength(1)
  })

  test('makes no claim the sign-up flow contradicts', () => {
    const text = norm(renderRoute(path).container.textContent)
    const hits = FORBIDDEN.filter(([, re]) => re.test(text)).map(([label]) => label)
    expect(hits, `${path} still says: ${hits.join(', ')}`).toEqual([])
  })

  test('shows no unverified testimonial', () => {
    const text = norm(renderRoute(path).container.textContent)
    expect(TESTIMONIAL_NAMES.filter((n) => text.includes(n))).toEqual([])
  })

  test('labels its sign-up button with the trial offer', () => {
    const { container } = renderRoute(path)
    const labels = [...container.querySelectorAll('a, button')].map((el) => norm(el.textContent))
    expect(labels).toContain(TRIAL_CTA_LABEL)
  })

  test.runIf(scope === 'marketing')('uses the current trial wording', () => {
    expect(norm(renderRoute(path).container.textContent)).not.toMatch(/התנסות/)
  })
})

test('the testimonial components are gone', () => {
  for (const file of [
    'components/lumen/sections/testimonials.tsx',
    'components/lumen/sections/testimonials-marquee.tsx',
    'components/seo/sections/TestimonialsSection.tsx',
    'components/ui/stagger-testimonials.tsx',
  ]) {
    expect(existsSync(file), file).toBe(false)
  }
})

test('the trial label and the price answer state the real terms', () => {
  expect(TRIAL_CTA_LABEL).toBe(`התחילו ${TRIAL_LENGTH_DAYS} ימי ניסיון`)
  expect(TRIAL_OFFER_FAQ_ANSWER).toContain('כרטיס אשראי')
  expect(TRIAL_OFFER_FAQ_ANSWER).toContain(`${PRICING.currency}${PRICING.monthly} לחודש`)
  expect(TRIAL_OFFER_FAQ_ANSWER).toContain('עד לביטול')
})

test('structured data prices the product at the real monthly price, not ₪0', () => {
  const { offers } = softwareApplicationSchema()
  expect(offers.price).toBe(String(PRICING.monthly))
  expect(offers.price).not.toBe('0')
  expect(offers.priceCurrency).toBe('ILS')
  expect(offers.priceSpecification).toMatchObject({ price: PRICING.monthly, priceCurrency: 'ILS', billingDuration: 'P1M' })
})
