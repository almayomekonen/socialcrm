// @vitest-environment jsdom
//
// Cancellation says what happened HERE, and claims nothing about the provider.
//
// Clicking "בטל מנוי" runs `cancelRenewal`, which sets `cancelAtPeriodEnd` on
// our own `subscriptions` row and returns (actions/subscription.ts). It opens no
// connection to the payment provider — the repository contains no outbound Grow
// client and no Grow API credentials — so the standing order is untouched and a
// further charge remains possible.
//
// Three surfaces nevertheless reported the cancellation as done: the modal's
// status line and the plan card's badge both read "המנוי בוטל", and the payment
// row promised "המנוי לא יתחדש ולא ייגבה חיוב נוסף". Two customers in
// production hold `cancelAtPeriodEnd = true` and were shown exactly that.
//
// These tests pin the replacement: every surface states the recorded request,
// none asserts a provider outcome, and the access-until-expiresAt messaging —
// which IS verified, since entitlement is driven by expiresAt alone — survives
// untouched.
//
// No DB: runs in the no-DB suite.

import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { EntitlementProvider } from '@/lib/entitlement/EntitlementContext'
import ManagePlanModal from '@/components/settings/payment/ManagePlanModal'
import PaymentMethodRow from '@/components/settings/payment/PaymentMethodRow'
import type { SubscriptionClientView } from '@/components/settings/payment/ManagePlanLauncher'

// The modal imports its two server actions at module scope. No assertion here
// invokes either — this file is about what the UI SAYS, never what it does.
vi.mock('@/actions/subscription', () => ({
  cancelRenewal: async () => ({ ok: true }),
  resumeRenewal: async () => ({ ok: true }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => '/settings/update_payment',
  useSearchParams: () => new URLSearchParams(),
}))

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8')

/**
 * Source with comments removed. Every file here explains the wording it stopped
 * using, so the removed phrases still appear in prose — asserting against raw
 * source would forbid documenting the fix. Only what can reach a screen counts.
 */
const readRendered = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

/** ModalPop portals its children, so the modal's text is never in `container`. */
const rendered = () => document.body.textContent ?? ''

const ACTIVE_ENTITLEMENT = { hasAccess: true, status: 'PAID', expiresAt: '2026-09-22T08:49:21.549Z' }

const CANCELLING_ROW: SubscriptionClientView = {
  plan: 'pro',
  expiresAtIso: '2026-09-22T08:49:21.549Z',
  cancelAtPeriodEnd: true,
  status: 'cancelling',
  manageable: true,
}

/**
 * The exact wording that asserted a provider outcome. Any surface reintroducing
 * one of these is claiming something the system still cannot observe.
 */
const PROVIDER_CLAIMS = ['המנוי בוטל', 'לא יתחדש', 'לא ייגבה חיוב נוסף']

function renderCancelling() {
  return render(
    <EntitlementProvider value={ACTIVE_ENTITLEMENT}>
      <ManagePlanModal open onClose={() => {}} subscription={CANCELLING_ROW} />
    </EntitlementProvider>,
  )
}

afterEach(cleanup)

describe('no surface reports the cancellation as completed', () => {
  it('the modal status line records the request instead of asserting "בוטל"', () => {
    renderCancelling()
    expect(rendered()).toContain('סטטוס: בקשת הביטול נקלטה')
    expect(rendered()).not.toContain('המנוי בוטל')
  })

  it('the plan card badge records the request instead of asserting "בוטל"', () => {
    const card = readRendered('components/settings/payment/ProPlanCard.tsx')
    expect(card).toContain('בקשת הביטול נקלטה')
    // 'המנוי הסתיים' (the expired badge) is a different, verified fact and stays.
    expect(card).toContain('המנוי הסתיים')
    expect(card).not.toContain('המנוי בוטל')
  })

  it('the payment row promises nothing about a future charge', () => {
    const { container } = render(<PaymentMethodRow state='cancelling' />)
    expect(container.textContent).toContain('בקשת הביטול נקלטה')
    expect(container.textContent).not.toContain('לא ייגבה חיוב נוסף')
    expect(container.textContent).not.toContain('החיוב הבא')
  })

  it('the confirm step describes recording a request, not stopping billing', () => {
    const modal = readRendered('components/settings/payment/ManagePlanBodies.tsx') // the confirm view (split from ManagePlanModal in Phase E4)
    expect(modal).toContain('בקשת הביטול תירשם')
    expect(modal).not.toContain('המנוי לא יתחדש')
  })

  it('none of the three surfaces carries any provider claim', () => {
    const sources = [
      'components/settings/payment/ManagePlanModal.tsx',
      'components/settings/payment/ManagePlanBodies.tsx',
      'components/settings/payment/ProPlanCard.tsx',
      'components/settings/payment/PaymentMethodRow.tsx',
    ]
    for (const file of sources) {
      const src = readRendered(file)
      for (const claim of PROVIDER_CLAIMS) {
        expect(src, `${file} still claims "${claim}"`).not.toContain(claim)
      }
    }
  })
})

describe('the paid-access facts are untouched', () => {
  it('still tells the cancelling customer how long Pro runs', () => {
    renderCancelling()
    expect(rendered()).toContain('גישה ל־Pro עד')
  })

  it('keeps the renewing and expired copy verbatim', () => {
    const row = read('components/settings/payment/PaymentMethodRow.tsx')
    expect(row).toContain('החיוב הבא ייגבה מהכרטיס ששימש לתשלום האחרון')
    expect(row).toContain('חידוש המנוי יחייב את הכרטיס ששימש לתשלום האחרון')
  })

  it('still offers the cancelling customer a way back', () => {
    renderCancelling()
    expect(rendered()).toContain('חידוש מסלול')
  })
})

describe('the change is UI-only', () => {
  it('cancelRenewal still writes exactly one flag and calls no provider', () => {
    const action = read('actions/subscription.ts')
    expect(action).toContain('cancelAtPeriodEnd: value')
    // No outbound call was introduced anywhere in the cancellation action.
    expect(action).not.toMatch(/fetch\(|axios|https?:\/\//)
  })

  it('entitlement still ignores cancellation entirely', () => {
    // Access is decided by plan + planReason + expiresAt. If cancellation ever
    // reaches this chain, cancelling would start revoking paid time.
    expect(read('lib/trial/index.ts')).not.toContain('cancelAtPeriodEnd')
    expect(read('lib/access/productAccess.ts')).not.toContain('cancelAtPeriodEnd')
    expect(read('db/trial.ts')).not.toContain('cancelAtPeriodEnd')
  })

  it('deriveStatus is unchanged — this fix relabels, it does not restate', () => {
    const view = read('lib/quota/subscription.ts')
    expect(view).toContain("return cancelAtPeriodEnd ? 'cancelling' : 'active'")
  })
})
