// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import AuthControlRow from '@/components/auth/AuthControlRow'

/**
 * Grow's site review (2026-09-18) failed three items, all on the payment page:
 * that one exists, that it carries a terms-acceptance checkbox, and that it
 * links to the תקנון.
 *
 * The card-setup screen has all three and always did — but it sits behind
 * registration, so an unauthenticated reviewer never reached it. The screen a
 * new customer actually meets first is signup, and there the checkbox was
 * decorative: no name, no `required`, no state. It rendered, and submitting
 * past it untouched worked.
 *
 * So the row is pinned here: required where the customer accepts terms,
 * optional where it is only remember-me, and unchecked in both cases.
 */

afterEach(cleanup)

describe('terms acceptance before payment', () => {
  it('the signup row demands the checkbox and it starts unticked', () => {
    render(<AuthControlRow checkboxId='terms' checkboxLabel='אני מסכים לתנאי השימוש' actionLabel='תנאי השימוש' checkboxRequired href='/terms' />)

    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.required).toBe(true)
    expect(box.checked).toBe(false)

    const link = screen.getByRole('link', { name: 'תנאי השימוש' })
    expect(link.getAttribute('href')).toBe('/terms')
  })

  it('sign-in’s remember-me stays optional — the prop is opt-in, not a blanket change', () => {
    render(<AuthControlRow checkboxId='remember' checkboxLabel='זכור אותי' actionLabel='שכחת סיסמה?' onAction={() => {}} />)
    const box = screen.getByRole('checkbox') as HTMLInputElement
    expect(box.required).toBe(false)
    expect(box.checked).toBe(false)
  })

  it('the label is bound to the box, so tapping the words ticks it', () => {
    render(<AuthControlRow checkboxId='terms' checkboxLabel='אני מסכים לתנאי השימוש' actionLabel='תנאי השימוש' checkboxRequired href='/terms' />)
    // getByLabelText only resolves through a real htmlFor/id pairing.
    expect(screen.getByLabelText('אני מסכים לתנאי השימוש')).toBeTruthy()
  })
})

describe('the route from marketing to signup', () => {
  /**
   * The reviewer began at the home page and every "start" CTA sent them to
   * /auth — the SIGN-IN box — where the only way onward was a small
   * "אין לך חשבון?" link. That is why a payment page was reported missing:
   * the journey never got past a login form.
   */
  it('every start CTA opens the signup page, not the sign-in box', async () => {
    const { readFileSync } = await import('fs')
    const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, 'utf8')

    for (const file of [
      'components/lumen/sections/hero.tsx',
      'components/lumen/sections/pricing.tsx',
      'components/seo/sections/FinalCTA.tsx',
      'components/ui/hero/HeroContent.tsx',
      'components/marketing/system/MarketingHeader.tsx',
    ]) {
      expect(read(file)).toContain('/auth/register')
    }

    // The header keeps a separate sign-in link; that one must stay on /auth.
    expect(read('components/marketing/system/MarketingHeader.tsx')).toContain("href='/auth'")
  })
})
