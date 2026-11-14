// @vitest-environment jsdom
/**
 * Heading-hierarchy guardrail for the public marketing routes.
 *
 * One `<h1>` per document is the baseline every search engine and screen reader
 * assumes. It is also the assertion most likely to be broken by a visual
 * redesign — a hero gets rebuilt, the headline becomes a styled `<div>`, and
 * nothing visibly changes while the page silently loses its heading.
 *
 * `<h2>`s are checked for non-emptiness rather than count: section structure is
 * free to change, but a heading element with no accessible text is a defect at
 * any scale.
 */

import { describe, test, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { cleanup } from '@testing-library/react'
import { renderPage, norm } from './harness'

// Inline, not imported: `vi.mock` is hoisted above the import block.
vi.mock('@/actions/auth', () => ({ getSessionState: async () => false, logout: async () => {} }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {}, back: () => {}, forward: () => {}, refresh: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  redirect: () => {},
  notFound: () => {},
}))

import Home from '@/app/(he)/(marketing)/page'
import Channels from '@/app/(he)/(marketing)/channels/page'
import Pricing from '@/app/(he)/(marketing)/pricing/page'
import Faq from '@/app/(he)/(marketing)/faq/page'
import CrmGuide from '@/app/(he)/(marketing)/crm/page'
import LeadManagement from '@/app/(he)/(marketing)/lead-management/page'
import WhatsappCrm from '@/app/(he)/(marketing)/whatsapp-crm/page'
import FacebookLeads from '@/app/(he)/(marketing)/facebook-leads/page'
import InstagramLeads from '@/app/(he)/(marketing)/instagram-leads/page'
import Privacy from '@/app/(he)/(marketing)/privacy/page'
import Terms from '@/app/(he)/(marketing)/terms/page'
import DataDeletion from '@/app/(he)/(marketing)/data-deletion/page'

afterEach(cleanup)

const PAGES: Array<[path: string, Component: () => React.ReactNode]> = [
  ['/', Home],
  ['/channels', Channels],
  ['/pricing', Pricing],
  ['/faq', Faq],
  ['/crm', CrmGuide],
  ['/lead-management', LeadManagement],
  ['/whatsapp-crm', WhatsappCrm],
  ['/facebook-leads', FacebookLeads],
  ['/instagram-leads', InstagramLeads],
  ['/privacy', Privacy],
  ['/terms', Terms],
  ['/data-deletion', DataDeletion],
]

describe.each(PAGES)('%s headings', (path, Component) => {
  test('renders exactly one <h1>, with text', () => {
    const { container } = renderPage(<Component />)
    const h1s = [...container.querySelectorAll('h1')]
    expect(h1s, `${path} must have exactly one <h1>`).toHaveLength(1)
    expect(norm(h1s[0].textContent).length).toBeGreaterThan(0)
  })

  test('no heading element is empty', () => {
    const { container } = renderPage(<Component />)
    const empty = [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')]
      .filter((h) => norm(h.textContent).length === 0)
      .map((h) => h.tagName)
    expect(empty, `${path} has empty headings`).toEqual([])
  })
})
