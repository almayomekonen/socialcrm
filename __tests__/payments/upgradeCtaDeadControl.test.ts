import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * A BUTTON THAT SCROLLS TO NOTHING.
 *
 * "שדרג ל-Pro" scrolled to #card-setup, a section the billing page renders
 * only when NO card is billed. An account with a verified card therefore
 * clicked a button whose target was absent from the DOM — getElementById
 * returned null, the optional chain swallowed it, and nothing happened at all.
 * Production agency 157 sat on exactly that: mid-trial, card saved, renewal
 * cancelled, upgrade button inert.
 *
 * Source-level because the defect is a missing condition, not a wrong value.
 */

const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, 'utf8')
const pkg = read('components/settings/payment/Packages.tsx')
/* Comments stripped for the "must not call" assertions: the block explaining
   why this surface defers to CardBillingControls names the very functions it
   must not call, and matching prose is not matching code. */
const pkgCode = pkg.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const page = read('app/(he)/(app)/settings/(user_settings)/update_payment/page.tsx')

describe('the upgrade CTA cannot be a silent no-op', () => {
  it('renders only when the scroll target is rendered', () => {
    // The button's condition and the section's condition are the same fact.
    expect(pkg).toContain('isProCard && !cardBilled ?')
    expect(page).toContain("{!cardView.cardBilled && (\n        <section id='card-setup'")
  })

  it('is fed the verified card state by the page', () => {
    expect(page).toContain('<Packages plan={plan} trialActive={trialActive} cardBilled={cardView.cardBilled} />')
  })

  it('does NOT duplicate the resume path', () => {
    /*
     * Resuming belongs to CardBillingControls, which routes through
     * resumeRenewal and its isCardResumeBlocked guard — the guard that stops a
     * resume after access has ended from charging immediately without warning.
     * A second resume here would bypass it.
     */
    expect(pkgCode).not.toContain('resumeRenewal')
    expect(pkgCode).not.toContain('startCardSetup')
    expect(pkgCode).not.toContain('cancelRenewal')
  })
})
