import { describe, it, expect } from 'vitest'
import { validatePaymentAtIssue, fulfillStateForCombinedDoc } from '@/lib/billing/payment/validation'
import { isPaymentMethod, paymentMethodLabel, PAYMENT_METHODS } from '@/lib/billing/payment/methods'

describe('validatePaymentAtIssue', () => {
  const ok = { paymentMethod: 'cash', paymentAmount: 100, paymentDate: '2026-05-14', invoiceTotal: 100 }

  it('passes for a full, well-formed payment matching the total', () => {
    expect(() => validatePaymentAtIssue(ok)).not.toThrow()
  })

  it('passes for partial payment (< total)', () => {
    expect(() => validatePaymentAtIssue({ ...ok, paymentAmount: 60 })).not.toThrow()
  })

  it('rejects overpayment', () => {
    expect(() => validatePaymentAtIssue({ ...ok, paymentAmount: 150 })).toThrow(
      'billing.validate.payment_amount_exceeds_total',
    )
  })

  it('rejects missing method', () => {
    expect(() => validatePaymentAtIssue({ ...ok, paymentMethod: '' })).toThrow(
      'billing.validate.payment_method_missing',
    )
    expect(() => validatePaymentAtIssue({ ...ok, paymentMethod: null })).toThrow(
      'billing.validate.payment_method_missing',
    )
  })

  it('rejects unknown method values', () => {
    expect(() => validatePaymentAtIssue({ ...ok, paymentMethod: 'bitcoin' })).toThrow(
      'billing.validate.payment_method_invalid',
    )
  })

  it('rejects missing or non-positive amount', () => {
    expect(() => validatePaymentAtIssue({ ...ok, paymentAmount: null })).toThrow(
      'billing.validate.payment_amount_missing',
    )
    expect(() => validatePaymentAtIssue({ ...ok, paymentAmount: 0 })).toThrow(
      'billing.validate.payment_amount_invalid',
    )
    expect(() => validatePaymentAtIssue({ ...ok, paymentAmount: -5 })).toThrow(
      'billing.validate.payment_amount_invalid',
    )
    expect(() => validatePaymentAtIssue({ ...ok, paymentAmount: NaN })).toThrow(
      'billing.validate.payment_amount_invalid',
    )
  })

  it('rejects missing date', () => {
    expect(() => validatePaymentAtIssue({ ...ok, paymentDate: '' })).toThrow(
      'billing.validate.payment_date_missing',
    )
    expect(() => validatePaymentAtIssue({ ...ok, paymentDate: null })).toThrow(
      'billing.validate.payment_date_missing',
    )
  })

  it('checks method before amount before date (deterministic order)', () => {
    expect(() =>
      validatePaymentAtIssue({ paymentMethod: '', paymentAmount: null, paymentDate: '', invoiceTotal: 100 }),
    ).toThrow('billing.validate.payment_method_missing')
  })
})

describe('fulfillStateForCombinedDoc', () => {
  it('returns paid when amount equals total', () => {
    expect(fulfillStateForCombinedDoc(100, 100)).toBe('paid')
  })

  it('returns paid when amount slightly exceeds total (rounding tolerance)', () => {
    expect(fulfillStateForCombinedDoc(100.001, 100)).toBe('paid')
  })

  it('returns partial when amount is less than total', () => {
    expect(fulfillStateForCombinedDoc(60, 100)).toBe('partial')
  })
})

describe('payment methods catalog', () => {
  it('isPaymentMethod accepts every catalog entry', () => {
    for (const m of PAYMENT_METHODS) {
      expect(isPaymentMethod(m)).toBe(true)
    }
  })

  it('isPaymentMethod rejects unknown values and non-strings', () => {
    expect(isPaymentMethod('bitcoin')).toBe(false)
    expect(isPaymentMethod('')).toBe(false)
    expect(isPaymentMethod(null)).toBe(false)
    expect(isPaymentMethod(undefined)).toBe(false)
    expect(isPaymentMethod(42)).toBe(false)
  })

  it('paymentMethodLabel returns the Hebrew label for known methods', () => {
    expect(paymentMethodLabel('cash')).toBe('מזומן')
    expect(paymentMethodLabel('bank_transfer')).toBe('העברה בנקאית')
  })

  it('paymentMethodLabel returns empty string for null/unknown', () => {
    expect(paymentMethodLabel(null)).toBe('')
    expect(paymentMethodLabel('')).toBe('')
    expect(paymentMethodLabel('made_up')).toBe('')
  })
})
