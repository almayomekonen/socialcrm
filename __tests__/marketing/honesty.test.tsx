// @vitest-environment jsdom
/**
 * Honesty guardrail for the public marketing pages (SEO Phase 0).
 *
 * The site used to say "התחל בחינם" / "ללא כרטיס אשראי" while sign-up requires
 * a saved card before the CRM opens (lib/trial), showed named customer quotes
 * no customer had given, quoted "×3 more closed leads" with no source, and
 * told Google the product costs ₪0. Each of those reads fine in review on its
 * own, so the rendered text of every page is checked here instead.
 */

import { describe, test, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { existsSync } from 'node:fs'
import { cleanup } from '@testing-library/react'
import { renderPage, norm } from './harness'
import { PRICING, TRIAL_CTA_LABEL, TRIAL_OFFER_FAQ_ANSWER } from '@/lib/pricing'
import { TRIAL_LENGTH_DAYS } from '@/lib/trial'
import { softwareApplicationSchema } from '@/lib/seo/schemas'

// Inline, not imported: `vi.mock` is hoisted above the import block.
vi.mock('@/actions/auth', () => ({ getSessionState: async () => false, logout: async () => {} }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {}, back: () => {}, forward: () => {}, refresh: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  redirect: () => {},
  notFound: () => {},
}))

import Home from '@/app/(marketing)/page'
import Channels from '@/app/(marketing)/channels/page'
import Pricing from '@/app/(marketing)/pricing/page'
import Faq from '@/app/(marketing)/faq/page'
import InstagramLeads from '@/app/(marketing)/instagram-leads-crm/page'
import CrmForWhatsapp from '@/app/(marketing)/crm-for-whatsapp-business/page'
import CrmVsExcel from '@/app/(marketing)/crm-vs-excel/page'
import { MarketingHeader } from '@/components/marketing/system/MarketingHeader'

afterEach(cleanup)

/** The legal pages are out of scope: their wording is not marketing copy. */
const PAGES: Array<[path: string, Component: () => React.ReactNode, hasSignupCta: boolean]> = [
  ['/', Home, true],
  ['/channels', Channels, false],
  ['/pricing', Pricing, true],
  ['/faq', Faq, false],
  ['/instagram-leads-crm', InstagramLeads, true],
  ['/crm-for-whatsapp-business', CrmForWhatsapp, true],
  ['/crm-vs-excel', CrmVsExcel, true],
]

/** Claims the verified sign-up flow contradicts, and numbers nothing measured. */
const FORBIDDEN: Array<[label: string, pattern: RegExp]> = [
  ['"free" sign-up', /בחינם|הרשמה חינמית|התוכנית החינמית/],
  ['"no credit card"', /ללא כרטיס|בלי כרטיס|לא דורשת? כרטיס|0\s*כרטיס אשראי/],
  ['unsourced multiplier', /×\s*3/],
  ['old trial wording', /התנסות/],
]

/** The names the removed testimonial sections attributed quotes to. */
const TESTIMONIAL_NAMES = ['רועי כהן', 'מיכל לוי', 'שירה אבגי', 'יוני פרץ']

describe.each(PAGES)('%s copy', (path, Component, hasSignupCta) => {
  test('makes no claim the sign-up flow contradicts', () => {
    const { container } = renderPage(<Component />)
    const text = norm(container.textContent)
    const hits = FORBIDDEN.filter(([, re]) => re.test(text)).map(([label]) => label)
    expect(hits, `${path} still says: ${hits.join(', ')}`).toEqual([])
  })

  test('shows no unverified testimonial', () => {
    const { container } = renderPage(<Component />)
    const text = norm(container.textContent)
    expect(TESTIMONIAL_NAMES.filter((n) => text.includes(n))).toEqual([])
  })

  test.runIf(hasSignupCta)('labels its sign-up button with the trial offer', () => {
    const { container } = renderPage(<Component />)
    expect(norm(container.textContent)).toContain(TRIAL_CTA_LABEL)
  })
})

test('the SEO-page header sign-up button names the trial, not a free plan', () => {
  const { container } = renderPage(<MarketingHeader />)
  const text = norm(container.textContent)
  expect(text).toContain(TRIAL_CTA_LABEL)
  expect(text).not.toMatch(/בחינם/)
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
