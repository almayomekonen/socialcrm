import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { isCardBillingAvailable } from '@/lib/payments/cardTrial/availability'

/**
 * With Payment Links removed there is exactly one way to pay, so a card CTA
 * that cannot complete is a dead end on the screen where the customer is
 * trying to give us money. Every surface asks this first.
 */
function stagingReady() {
  vi.stubEnv('APP_ENV', 'staging')
  vi.stubEnv('GROW_MODE', 'sandbox')
  vi.stubEnv('GROW_SANDBOX_ISOLATED_DATA', 'true')
  vi.stubEnv('GROW_USER_ID', 'u-1')
  vi.stubEnv('GROW_PAGE_CODE_TOKEN', 'p-1')
  vi.stubEnv('APP_HOST', 'staging.example.com')
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
  vi.stubEnv('GROW_LOCAL_MOCK', '')
}

afterEach(() => vi.unstubAllEnvs())

describe('isCardBillingAvailable', () => {
  it('is true when the runtime may call Grow and Grow is configured', () => {
    stagingReady()
    expect(isCardBillingAvailable()).toBe(true)
  })

  it('is false without the credentials, so no CTA is offered that cannot open a page', () => {
    stagingReady()
    vi.stubEnv('GROW_USER_ID', '')
    expect(isCardBillingAvailable()).toBe(false)
    stagingReady()
    vi.stubEnv('GROW_PAGE_CODE_TOKEN', '')
    expect(isCardBillingAvailable()).toBe(false)
  })

  it('is false when the runtime guard refuses', () => {
    stagingReady()
    vi.stubEnv('GROW_SANDBOX_ISOLATED_DATA', '') // staging without isolated data
    expect(isCardBillingAvailable()).toBe(false)
  })

  it('is false when Grow could not call us back', () => {
    stagingReady()
    vi.stubEnv('APP_HOST', 'localhost:3000')
    expect(isCardBillingAvailable()).toBe(false)
    stagingReady()
    vi.stubEnv('APP_HOST', '')
    expect(isCardBillingAvailable()).toBe(false)
  })
})

describe('the billing screen never offers a retired checkout', () => {
  const page = readFileSync('app/(app)/settings/(user_settings)/update_payment/page.tsx', 'utf8')

  it('shows a temporary-unavailability state instead of a dead-end CTA', () => {
    expect(page).toContain('PaymentsUnavailableNotice')
    // Gates on the same provider check, now via the variant that also reports
    // WHY — production showed this notice and logged nothing, so the cause
    // could not be told apart from a missing credential without guessing.
    expect(page).toContain('describeCardBillingAvailability()')
    // Offered only when the provider can complete it AND a purpose applies.
    expect(page).toContain('canStartSetup && setupPurpose')
  })

  it('records a non-sensitive reason when it declines to offer a setup', () => {
    expect(page).toContain("console.warn('[CardSetup] setup not offered'")
    for (const field of ['providerAvailable', 'providerReason', 'trialStatus', 'setupPurpose']) {
      expect(page).toContain(field)
    }
    // Condition codes only. Nothing that could carry a credential or a card.
    for (const secret of ['cardToken', 'GROW_USER_ID', 'GROW_PAGE_CODE_TOKEN', 'processToken']) {
      expect(page).not.toContain(secret)
    }
  })

  it('links to no Payment Link anywhere', () => {
    expect(page).not.toContain('/api/payments/upgrade')
    expect(page).not.toContain('isAnnualLinkConfigured')
  })

  it('does not promise a trial or a payment while billing is unavailable', () => {
    // The notice's copy lives in the catalog since Phase E4; the component picks it by `hasAccess`.
    const component = readFileSync('components/billing/PaymentsUnavailableNotice.tsx', 'utf8')
    expect(component).toContain("t('settings.payment.unavailable.withAccess')")
    expect(component).toContain("t('settings.payment.unavailable.noAccess')")
    const notice = component + readFileSync('lib/i18n/messages/he/settings/payment.ts', 'utf8').split('unavailable: {')[1]
    expect(notice).toContain('לא בוצע חיוב')
    // "your access is unaffected" is a lie to an account that has none.
    expect(notice).toContain('hasAccess')
    expect(notice).toContain('לא ניתן להפעיל כרגע את הגישה למערכת')
    for (const forbidden of ['הניסיון הופעל', 'התשלום בוצע', 'שולם']) {
      expect(notice).not.toContain(forbidden)
    }
  })
})
