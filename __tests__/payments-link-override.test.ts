/**
 * Per-user Grow payment-link override — pure unit tests.
 *
 * No DB: this file exercises the link builder and the override map only.
 * The central guarantee under test is negative — EVERY user except the one
 * listed address keeps the exact link they got before overrides existed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getUpgradeLink } from '@/lib/payments/link'
import { getPaymentLinkOverride } from '@/lib/payments/overrides'

const DEFAULT_LINK = 'https://pay.grow.link/default-monthly'
const DEFAULT_ANNUAL_LINK = 'https://pay.grow.link/default-annual'
const CUSTOM_LINK = 'https://pay.grow.link/custom-for-ariel'
const OVERRIDE_EMAIL = 'ariel.dalal@gmail.com'
const OVERRIDE_ENV = 'GROW_PAYMENT_LINK_OVERRIDE__ARIEL_DALAL'

beforeEach(() => {
  process.env.APP_ENV = 'test'
  process.env.GROW_TOKEN_SECRET = 'test_token_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  process.env.GROW_PAYMENT_LINK = DEFAULT_LINK
  process.env.GROW_PAYMENT_LINK_ANNUAL = DEFAULT_ANNUAL_LINK
  process.env[OVERRIDE_ENV] = CUSTOM_LINK
})

afterEach(() => {
  delete process.env[OVERRIDE_ENV]
  delete process.env.GROW_PAYMENT_LINK_OVERRIDE__ARIEL_DALAL_ANNUAL
})

const origin = (url: string) => {
  const u = new URL(url)
  return u.origin + u.pathname
}

describe('getPaymentLinkOverride — matching rules', () => {
  it('matches the configured email exactly', () => {
    expect(getPaymentLinkOverride(OVERRIDE_EMAIL, 'monthly')).toBe(CUSTOM_LINK)
  })

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(getPaymentLinkOverride('Ariel.Dalal@Gmail.com', 'monthly')).toBe(CUSTOM_LINK)
    expect(getPaymentLinkOverride('ARIEL.DALAL@GMAIL.COM', 'monthly')).toBe(CUSTOM_LINK)
    expect(getPaymentLinkOverride('  ariel.dalal@gmail.com  ', 'monthly')).toBe(CUSTOM_LINK)
  })

  it('does NOT match near-miss addresses', () => {
    const nearMisses = [
      'ariel.dalal@gmail.com.attacker.com',
      'xariel.dalal@gmail.com',
      'ariel.dalal@gmail.co',
      'arieldalal@gmail.com', // gmail dot-alias is NOT treated as the same user
      'ariel.dalal+test@gmail.com',
      'ariel.dalal@googlemail.com',
    ]
    for (const email of nearMisses) {
      expect(getPaymentLinkOverride(email, 'monthly'), email).toBeNull()
    }
  })

  it('returns null for absent/empty emails', () => {
    expect(getPaymentLinkOverride(null, 'monthly')).toBeNull()
    expect(getPaymentLinkOverride(undefined, 'monthly')).toBeNull()
    expect(getPaymentLinkOverride('', 'monthly')).toBeNull()
    expect(getPaymentLinkOverride('   ', 'monthly')).toBeNull()
  })

  it('falls back to null when the override env var is unset or blank', () => {
    delete process.env[OVERRIDE_ENV]
    expect(getPaymentLinkOverride(OVERRIDE_EMAIL, 'monthly')).toBeNull()

    process.env[OVERRIDE_ENV] = '   '
    expect(getPaymentLinkOverride(OVERRIDE_EMAIL, 'monthly')).toBeNull()
  })
})

describe('getUpgradeLink — override integration', () => {
  it('gives the overridden user the custom base URL', () => {
    expect(origin(getUpgradeLink(42, 'monthly', OVERRIDE_EMAIL))).toBe(CUSTOM_LINK)
  })

  it('gives every other user the default link, unchanged', () => {
    for (const email of ['someone@else.com', 'admin@getsocialcrm.com', null, undefined]) {
      expect(origin(getUpgradeLink(42, 'monthly', email)), String(email)).toBe(DEFAULT_LINK)
    }
  })

  it('keeps the pre-existing 2-arg and 1-arg call signatures on the default link', () => {
    expect(origin(getUpgradeLink(42))).toBe(DEFAULT_LINK)
    expect(origin(getUpgradeLink(42, 'monthly'))).toBe(DEFAULT_LINK)
    expect(origin(getUpgradeLink(42, 'annual'))).toBe(DEFAULT_ANNUAL_LINK)
  })

  it('overridden user still gets identifyParam + return_url (same downstream path)', () => {
    const url = new URL(getUpgradeLink(42, 'monthly', OVERRIDE_EMAIL))
    expect(url.searchParams.get('identifyParam')!.length).toBeGreaterThan(20)
    expect(url.searchParams.get('return_url')).toBe('http://localhost:3000/billing/success')
  })

  it('falls back to the default link when the override env is unset (deploys inert)', () => {
    delete process.env[OVERRIDE_ENV]
    expect(origin(getUpgradeLink(42, 'monthly', OVERRIDE_EMAIL))).toBe(DEFAULT_LINK)
  })

  it('period is respected: annual without an annual override uses the default annual link', () => {
    expect(origin(getUpgradeLink(42, 'annual', OVERRIDE_EMAIL))).toBe(DEFAULT_ANNUAL_LINK)
  })

  it('still throws when neither an override nor an env link is configured', () => {
    delete process.env[OVERRIDE_ENV]
    delete process.env.GROW_PAYMENT_LINK
    expect(() => getUpgradeLink(42, 'monthly', OVERRIDE_EMAIL)).toThrow(/not configured/)
  })
})
