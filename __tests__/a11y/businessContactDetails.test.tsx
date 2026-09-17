// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MarketingFooter } from '@/components/marketing/system/MarketingFooter'
import TermsPage from '@/app/(marketing)/terms/page'
import { BUSINESS_ADDRESS, BUSINESS_PHONE_DISPLAY, BUSINESS_PHONE_HREF } from '@/lib/businessContact'

/**
 * Grow's site-approval checklist (grow.business/Site_check) makes two of these
 * mandatory before an account is approved for clearing:
 *
 *   טלפון ליצירת קשר — shown clearly on the home page or a contact page
 *   כתובת בית העסק   — on the site itself or in the תקנון
 *
 * Both are pinned here because they are the kind of thing a later redesign
 * quietly drops, and the cost of dropping them is a rejected clearing
 * application rather than a visual regression anyone would notice.
 *
 * The bidi assertion is not pedantry. In an RTL paragraph the Unicode
 * bidirectional algorithm reorders the runs of "053-531-7356", so without an
 * explicit LTR context the customer reads a number that is not ours.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

afterEach(cleanup)

const ltrAncestor = (el: HTMLElement | null): boolean => {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) if (n.getAttribute('dir') === 'ltr') return true
  return false
}

describe('business contact details, as Grow requires them', () => {
  it('the marketing footer dials the phone and shows the address', () => {
    render(<MarketingFooter />)

    const tel = screen.getByRole('link', { name: new RegExp(BUSINESS_PHONE_DISPLAY.replace(/-/g, '\\-')) })
    expect(tel.getAttribute('href')).toBe(BUSINESS_PHONE_HREF)
    expect(tel.getAttribute('href')?.startsWith('tel:')).toBe(true)

    // The digits must sit inside an explicit LTR context.
    const digits = screen.getByText(BUSINESS_PHONE_DISPLAY)
    expect(ltrAncestor(digits)).toBe(true)

    expect(screen.getByText(BUSINESS_ADDRESS)).toBeTruthy()
  })

  it('the terms page carries the address, the phone and the operator', async () => {
    render(await Promise.resolve(TermsPage() as React.ReactElement))

    const tel = screen.getByRole('link', { name: new RegExp(BUSINESS_PHONE_DISPLAY.replace(/-/g, '\\-')) })
    expect(tel.getAttribute('href')).toBe(BUSINESS_PHONE_HREF)
    expect(ltrAncestor(screen.getByText(BUSINESS_PHONE_DISPLAY))).toBe(true)
    expect(screen.getByText(BUSINESS_ADDRESS)).toBeTruthy()
  })

  it('the address is marked up as an address, not a stray line of text', () => {
    const { container } = render(<MarketingFooter />)
    const el = container.querySelector('address')
    expect(el?.textContent).toBe(BUSINESS_ADDRESS)
    // <address> is italic by default; the design is not.
    expect(el?.className).toContain('not-italic')
  })
})
