import { describe, it, expect } from 'vitest'
import { interpretTokenLookup } from '@/lib/payments/grow/interpretTokenLookup'
import type { GrowEnvelope } from '@/lib/payments/grow/http'

/**
 * The observed contract, and everything outside it.
 *
 * Only one case was ever seen on the wire (sandbox, 2026-09-17): a single
 * transaction with statusCode 2 and a transactionId, for the amount charged.
 * Every other response must come back `undetermined` — most importantly the
 * EMPTY one, which is indistinguishable from not-yet-visible and must never be
 * read as "not charged", because that licences a second charge.
 */
const env = (data: unknown, status = 1): GrowEnvelope => ({ status, err: null, data } as GrowEnvelope)
const paidRow = { transactionId: '549236', transactionToken: '1da65bfe07eac568947e765dd1d012d8', statusCode: 2, status: 'שולם', sum: '1', asmachta: '131226262' }

describe('interpretTokenLookup', () => {
  it('reads the observed paid response', () => {
    expect(interpretTokenLookup(env({ transactions: [paidRow] }), { sum: 1 })).toEqual({
      kind: 'paid',
      transactionId: '549236',
      transactionToken: '1da65bfe07eac568947e765dd1d012d8',
      asmachta: '131226262',
      statusCode: '2',
    })
  })

  it('an EMPTY result is undetermined — never "not charged"', () => {
    const v = interpretTokenLookup(env({ transactions: [] }), { sum: 1 })
    expect(v).toEqual({ kind: 'undetermined', reason: 'no_transactions_returned' })
    expect(v.kind).not.toBe('paid')
  })

  it('is undetermined for everything it has not observed', () => {
    const cases: Array<[string, GrowEnvelope]> = [
      ['envelope error', env({ transactions: [paidRow] }, 0)],
      ['missing transactions', env({})],
      ['not an array', env({ transactions: 'nope' })],
      ['several transactions', env({ transactions: [paidRow, paidRow] })],
      ['another status code', env({ transactions: [{ ...paidRow, statusCode: 11 }] })],
      ['paid without an id', env({ transactions: [{ ...paidRow, transactionId: '' }] })],
      ['null data', env(null)],
    ]
    for (const [name, e] of cases) {
      expect(interpretTokenLookup(e, { sum: 1 }).kind, name).toBe('undetermined')
    }
  })

  it('refuses to settle an amount other than the one charged', () => {
    expect(interpretTokenLookup(env({ transactions: [{ ...paidRow, sum: '89' }] }), { sum: 1 })).toMatchObject({ kind: 'undetermined' })
    expect(interpretTokenLookup(env({ transactions: [{ ...paidRow, sum: null }] }), { sum: 1 })).toMatchObject({ kind: 'undetermined' })
  })
})
