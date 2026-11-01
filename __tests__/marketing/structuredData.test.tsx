// @vitest-environment jsdom
/**
 * Structured-data guardrail for the public marketing routes.
 *
 * Two classes of failure this catches:
 *
 *  1. **Malformed or dropped JSON-LD.** A redesign that rewrites a page is very
 *     likely to move or lose the `<JsonLd>` calls; nothing about the page LOOKS
 *     broken when that happens, so only a test notices.
 *
 *  2. **Schema that lies about the page.** `FAQPage` markup asserts to Google
 *     that specific Q&A text is ON the page. If the rendered FAQ says something
 *     different, the markup is a misrepresentation — Google treats that as a
 *     structured-data violation, and it is invisible in review because both
 *     halves independently look fine. `/crm` currently ships one FAQ list in
 *     JSON-LD and a different, hand-duplicated one in the UI.
 */

import { describe, test, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { cleanup } from '@testing-library/react'
import { renderPage, structuredData, norm } from './harness'

vi.mock('@/actions/auth', () => ({ getSessionState: async () => false, logout: async () => {} }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {}, back: () => {}, forward: () => {}, refresh: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  redirect: () => {},
  notFound: () => {},
}))

import Home from '@/app/(he)/(marketing)/page'
import MarketingLayout from '@/app/(he)/(marketing)/layout'

afterEach(cleanup)

/** Pages that carry their own JSON-LD (the layout supplies the site-wide graphs). */
const PAGES: Array<[path: string, Component: () => React.ReactNode]> = [
  ['/', Home],
]

test('the marketing layout emits the three site-wide graphs', () => {
  const { container } = renderPage(<MarketingLayout>{null}</MarketingLayout>)
  const types = structuredData(container).map((d) => d['@type'])
  expect(types).toContain('Organization')
  expect(types).toContain('SoftwareApplication')
  expect(types).toContain('WebSite')
})

describe.each(PAGES)('%s structured data', (path, Component) => {
  test('every JSON-LD block parses and is a typed schema.org node', () => {
    const { container } = renderPage(<Component />)
    const blocks = structuredData(container)
    expect(blocks.length, `${path} emits no JSON-LD`).toBeGreaterThan(0)
    for (const block of blocks) {
      expect(block['@context']).toBe('https://schema.org')
      expect(typeof block['@type']).toBe('string')
      expect((block['@type'] as string).length).toBeGreaterThan(0)
    }
  })

  test('every FAQPage question is actually rendered on the page', () => {
    const { container } = renderPage(<Component />)
    const faqBlocks = structuredData(container).filter((b) => b['@type'] === 'FAQPage')
    if (faqBlocks.length === 0) return

    const pageText = norm(container.textContent)

    for (const block of faqBlocks) {
      const entities = block.mainEntity as Array<{ name: string; acceptedAnswer?: { text?: string } }>
      expect(Array.isArray(entities)).toBe(true)

      const missing = entities.map((e) => norm(e.name)).filter((q) => !pageText.includes(q))

      expect(
        missing,
        `${path}: FAQPage markup claims questions that are not on the page:\n  ` +
          missing.join('\n  '),
      ).toEqual([])
    }
  })

  test('at most one FAQPage block', () => {
    const { container } = renderPage(<Component />)
    const faqBlocks = structuredData(container).filter((b) => b['@type'] === 'FAQPage')
    expect(faqBlocks.length).toBeLessThanOrEqual(1)
  })
})
