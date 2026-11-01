import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * THE ACTION MUST COME FROM THE CARD, NOT THE PLAN.
 *
 * Production agency 157 saved a real card (row 14, Mastercard 0484, verified
 * 2026-09-28T05:25:28Z) and the billing page still read:
 *
 *   מסלול נוכחי: Pro · סטטוס: פעיל · [הוספת אמצעי תשלום]
 *
 * The plan box branched on `isPro && subscription`, and a TRIALING agency has
 * plan 'free', so it fell to the else arm and offered a FIRST-card button to an
 * account that already had one. Worse, that button's href is #card-setup, a
 * section rendered only when `!cardView.cardBilled` — so on the very accounts
 * that saw the button, the anchor pointed at nothing.
 *
 * Source-level because the defect is which condition gates the element.
 */

const page = readFileSync(`${process.cwd()}/app/(he)/(app)/settings/(user_settings)/update_payment/page.tsx`, 'utf8')
/* Comments stripped for the "appears once" count: the block explaining this
   fix quotes the label it removed, and matching prose is not matching UI. */
const pageCode = page.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
const boxCode = readFileSync(`${process.cwd()}/components/settings/payment/PlanStatusBox.tsx`, 'utf8').replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')

const box = readFileSync(`${process.cwd()}/components/settings/payment/PlanStatusBox.tsx`, 'utf8')

describe('billing page actions derive from verified card state', () => {
  it('passes the VERIFIED CARD state into the box, not the plan', () => {
    expect(page).toContain('<PlanStatusBox trialActive={trialActive} canAddFirstCard={!cardView.cardBilled} locale={locale} />')
  })

  it('the CTA exists once, behind that flag', () => {
    expect(box).toContain('{canAddFirstCard && (')
    // The label is `settings.payment.plan.addMethod` since Phase E4 ('הוספת אמצעי תשלום').
    expect(boxCode.split("t('settings.payment.plan.addMethod')").length - 1).toBe(1)
    // It must not have been left behind in the page as well.
    expect(pageCode).not.toContain('הוספת אמצעי תשלום')
    expect(pageCode).not.toContain('settings.payment.plan.addMethod')
  })

  it('the anchor and its target are gated by the same fact, so no empty anchor', () => {
    expect(box).toContain("href='#card-setup'")
    expect(page).toContain("{!cardView.cardBilled && (\n        <section id='card-setup'")
  })

  it('still shows the plan line for both trial and free', () => {
    expect(box).toContain("{trialActive ? t('settings.payment.plan.current') : t('settings.payment.plan.free')}")
    expect(box).toContain("{trialActive ? t('settings.payment.plan.statusActive') : t('settings.payment.plan.statusInactive')}")
  })

  it('keeps the card summary as the single card-management surface', () => {
    expect(page).toContain('{cardView.cardBilled && <CardOnFileSummary')
  })
})

/**
 * The states the page must still tell apart, asserted where they are decided.
 */
describe('card state classification is unchanged', () => {
  const view = readFileSync(`${process.cwd()}/lib/payments/cardTrial/cardTrialView.ts`, 'utf8')
  const avail = readFileSync(`${process.cwd()}/lib/payments/cardTrial/availability.ts`, 'utf8')

  it('an active card is read from the ACTIVE row, so a newer abandoned row cannot hide it', () => {
    expect(view).toContain('cardBilled: Boolean(latest?.confirmedAt || active)')
    expect(view).toContain('card: active ?')
  })

  it('pending with a callback is verification; pending without one keeps the retry form', () => {
    expect(view).toContain("return latest.lastCallbackAt ? 'awaiting_verification' : 'in_progress'")
    expect(avail).toContain("if (latest?.status === 'pending' && latest.lastCallbackAt) return { stage: 'awaiting', resume: null }")
  })
})
