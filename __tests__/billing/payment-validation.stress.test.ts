import { describe, it, expect } from 'vitest'
import {
  validatePaymentAtIssue,
  fulfillStateForCombinedDoc,
  round2,
} from '@/lib/billing/payment/validation'

/**
 * Destructive tests for the payment validation gate. The goal is to find
 * inputs that either (a) bypass validation when they shouldn't, or (b)
 * incorrectly reject valid inputs.
 */

const VALID = {
  paymentMethod: 'cash',
  paymentAmount: 100,
  paymentDate: '2026-05-18',
  invoiceTotal: 100,
}

function expectThrows(input: Parameters<typeof validatePaymentAtIssue>[0], message: string) {
  expect(() => validatePaymentAtIssue(input)).toThrowError(message)
}

describe('validatePaymentAtIssue — happy path baseline', () => {
  it('accepts a clean exact-match payment', () => {
    expect(() => validatePaymentAtIssue(VALID)).not.toThrow()
  })

  it('accepts partial payment below total (will be flagged as partial fulfillment)', () => {
    expect(() => validatePaymentAtIssue({ ...VALID, paymentAmount: 50 })).not.toThrow()
  })
})

describe('validatePaymentAtIssue — paymentMethod abuse', () => {
  it('rejects empty string', () => {
    expectThrows({ ...VALID, paymentMethod: '' }, 'billing.validate.payment_method_missing')
  })

  it('rejects whitespace-only', () => {
    expectThrows({ ...VALID, paymentMethod: '   ' }, 'billing.validate.payment_method_missing')
  })

  it('rejects null', () => {
    expectThrows({ ...VALID, paymentMethod: null }, 'billing.validate.payment_method_missing')
  })

  it('rejects undefined', () => {
    expectThrows({ ...VALID, paymentMethod: undefined }, 'billing.validate.payment_method_missing')
  })

  it('rejects an unknown method (typo)', () => {
    expectThrows({ ...VALID, paymentMethod: 'paypal' }, 'billing.validate.payment_method_invalid')
  })

  it('rejects case-shifted method (cAsh)', () => {
    expectThrows({ ...VALID, paymentMethod: 'cAsh' }, 'billing.validate.payment_method_invalid')
  })

  it('FAILS-OPEN-CANDIDATE: surrounding whitespace is silently trimmed', () => {
    // Documents current behavior: a leading/trailing space passes validation.
    // Probably fine for accidental UI whitespace, but worth knowing it's
    // permissive. Switch to .toThrow if we want to require strict input.
    expect(() => validatePaymentAtIssue({ ...VALID, paymentMethod: '  cash  ' })).not.toThrow()
  })
})

describe('validatePaymentAtIssue — paymentAmount abuse', () => {
  it('rejects null', () => {
    expectThrows({ ...VALID, paymentAmount: null }, 'billing.validate.payment_amount_missing')
  })

  it('rejects undefined', () => {
    expectThrows({ ...VALID, paymentAmount: undefined }, 'billing.validate.payment_amount_missing')
  })

  it('rejects 0', () => {
    expectThrows({ ...VALID, paymentAmount: 0 }, 'billing.validate.payment_amount_invalid')
  })

  it('rejects -0', () => {
    expectThrows({ ...VALID, paymentAmount: -0 }, 'billing.validate.payment_amount_invalid')
  })

  it('rejects negative', () => {
    expectThrows({ ...VALID, paymentAmount: -50 }, 'billing.validate.payment_amount_invalid')
  })

  it('rejects NaN', () => {
    expectThrows({ ...VALID, paymentAmount: Number.NaN }, 'billing.validate.payment_amount_invalid')
  })

  it('rejects Infinity', () => {
    expectThrows({ ...VALID, paymentAmount: Number.POSITIVE_INFINITY }, 'billing.validate.payment_amount_invalid')
  })

  it('rejects -Infinity', () => {
    expectThrows({ ...VALID, paymentAmount: Number.NEGATIVE_INFINITY }, 'billing.validate.payment_amount_invalid')
  })

  it('rejects amount > total by a full cent', () => {
    expectThrows({ ...VALID, paymentAmount: 100.01 }, 'billing.validate.payment_amount_exceeds_total')
  })

  it('rejects amount substantially > total', () => {
    expectThrows({ ...VALID, paymentAmount: 999999 }, 'billing.validate.payment_amount_exceeds_total')
  })

  it('accepts amount exactly equal to total', () => {
    expect(() => validatePaymentAtIssue({ ...VALID, paymentAmount: 100 })).not.toThrow()
  })

  it('FAILS-OPEN-CANDIDATE: amount over by sub-cent is accepted', () => {
    // 100.001 rounds to 100.00 in round2; check uses round2 on both sides
    // so it passes. Documents the precision tolerance — small overpayment
    // is silently allowed.
    expect(() =>
      validatePaymentAtIssue({ ...VALID, paymentAmount: 100.001 }),
    ).not.toThrow()
  })

  it('FAILS-OPEN-CANDIDATE: amount that rounds up over total still passes', () => {
    // total = 100.00, paymentAmount = 100.0049
    // round2(100.0049) = 100.00, round2(100) = 100.00, check passes.
    // This is the edge of "round to even" / "round half up" tolerance —
    // not a financial integrity issue, but a documented surprise.
    expect(() =>
      validatePaymentAtIssue({ ...VALID, paymentAmount: 100.0049 }),
    ).not.toThrow()
  })
})

describe('validatePaymentAtIssue — paymentDate abuse (KNOWN WEAKNESS)', () => {
  // The current implementation only checks `paymentDate.trim()` is non-empty.
  // Garbage and out-of-range strings pass the gate. The DB column is `date`
  // so the database WILL reject these on INSERT — but we'd rather catch them
  // in user-facing validation with a clean error reason.

  it('rejects empty', () => {
    expectThrows({ ...VALID, paymentDate: '' }, 'billing.validate.payment_date_missing')
  })

  it('rejects whitespace-only', () => {
    expectThrows({ ...VALID, paymentDate: '   ' }, 'billing.validate.payment_date_missing')
  })

  it('rejects null', () => {
    expectThrows({ ...VALID, paymentDate: null }, 'billing.validate.payment_date_missing')
  })

  it('WEAKNESS: garbage strings pass the validator', () => {
    // Documents current weakness — date-shape validation lives at the DB
    // layer only. Worth a real validator at the application layer.
    expect(() => validatePaymentAtIssue({ ...VALID, paymentDate: 'banana' })).not.toThrow()
    expect(() => validatePaymentAtIssue({ ...VALID, paymentDate: '2026-13-99' })).not.toThrow()
    expect(() => validatePaymentAtIssue({ ...VALID, paymentDate: 'tomorrow' })).not.toThrow()
  })

  it('WEAKNESS: far-future date passes', () => {
    expect(() => validatePaymentAtIssue({ ...VALID, paymentDate: '9999-12-31' })).not.toThrow()
  })

  it('WEAKNESS: pre-epoch date passes', () => {
    expect(() => validatePaymentAtIssue({ ...VALID, paymentDate: '1900-01-01' })).not.toThrow()
  })
})

describe('fulfillStateForCombinedDoc — boundary behavior', () => {
  it('exact equals returns paid', () => {
    expect(fulfillStateForCombinedDoc(100, 100)).toBe('paid')
  })

  it('exact equals at penny precision returns paid', () => {
    expect(fulfillStateForCombinedDoc(99.99, 99.99)).toBe('paid')
  })

  it('one cent short returns partial', () => {
    expect(fulfillStateForCombinedDoc(99.99, 100)).toBe('partial')
  })

  it('sub-cent over returns paid (rounding tolerance)', () => {
    expect(fulfillStateForCombinedDoc(100.001, 100)).toBe('paid')
  })

  it('zero payment returns partial', () => {
    // This shouldn't happen in practice because amount=0 is rejected by
    // validatePaymentAtIssue, but the projection helper is called
    // independently — its behavior should be defined.
    expect(fulfillStateForCombinedDoc(0, 100)).toBe('partial')
  })
})

describe('round2 — pure helper invariants', () => {
  it('rounds 0.005 deterministically', () => {
    // Documents Math.round behavior at the half-cent — for billing this
    // matters because a 0.005 line value might land different from
    // user expectation.
    const r = round2(0.005)
    expect([0.0, 0.01]).toContain(r)
  })

  it('-0 round-trips to a value that is zero-equivalent under math', () => {
    // JS quirk: Object.is(-0, +0) === false but -0 + 1 === 1.
    // round2(-0) returns -0 today; assert numeric equivalence rather than
    // identity so we don't break on a documented language behaviour.
    const r = round2(-0)
    expect(r === 0 || Object.is(r, -0)).toBe(true)
  })

  it('NaN round-trips to NaN', () => {
    expect(Number.isNaN(round2(NaN))).toBe(true)
  })

  it('Infinity round-trips to NaN/Infinity (documented behavior)', () => {
    // Math.round(Infinity * 100) / 100 = Infinity / 100 = Infinity
    const r = round2(Infinity)
    expect(Number.isFinite(r)).toBe(false)
  })
})
