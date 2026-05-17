import { describe, it, expect } from 'vitest'
import { effectiveTaxRatePercent } from '@/lib/billing/issuer/effectiveTaxRate'

/**
 * Central tax-policy resolver. Tested in isolation because every line
 * creation, draft preview, and issuance routes through this one function —
 * if the policy is wrong here it's wrong everywhere.
 */

describe('effectiveTaxRatePercent — business-type policy', () => {
  it('exempt issuer zeroes the rate (W6 — עוסק פטור)', () => {
    expect(effectiveTaxRatePercent({ businessType: 'exempt', baseRatePercent: 18 })).toBe(0)
  })

  it('exempt issuer zeroes the rate regardless of the base value', () => {
    expect(effectiveTaxRatePercent({ businessType: 'exempt', baseRatePercent: 17 })).toBe(0)
    expect(effectiveTaxRatePercent({ businessType: 'exempt', baseRatePercent: 0 })).toBe(0)
    expect(effectiveTaxRatePercent({ businessType: 'exempt', baseRatePercent: 100 })).toBe(0)
  })

  it('authorized issuer passes the base rate through unchanged', () => {
    expect(effectiveTaxRatePercent({ businessType: 'authorized', baseRatePercent: 18 })).toBe(18)
    expect(effectiveTaxRatePercent({ businessType: 'authorized', baseRatePercent: 17 })).toBe(17)
  })

  it('company issuer passes the base rate through unchanged', () => {
    expect(effectiveTaxRatePercent({ businessType: 'company', baseRatePercent: 18 })).toBe(18)
  })

  it('null business type defaults to applying the base rate (draft preview before issuer setup)', () => {
    // Issuance is gated on issuer completeness, so null businessType only
    // surfaces during pre-setup drafts. Defaulting to "apply rate" mirrors
    // today's behaviour for incomplete issuers; the issuer-completeness
    // gate is what actually prevents issuing in this state.
    expect(effectiveTaxRatePercent({ businessType: null, baseRatePercent: 18 })).toBe(18)
  })

  it('null business type with no base rate falls through to zero (no charge to apply)', () => {
    expect(effectiveTaxRatePercent({ businessType: null, baseRatePercent: 0 })).toBe(0)
  })
})
