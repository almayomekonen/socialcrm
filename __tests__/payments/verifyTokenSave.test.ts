import { describe, it, expect, vi } from 'vitest'
import { createGrowTokenSaveVerifier } from '@/lib/payments/cardTrial/verifyTokenSave'
import {
  GROW_PROVIDER_EVIDENCE,
  isTokenChargeDispatchEstablished,
  isTokenChargeReconciliationEstablished,
  isTokenSaveVerificationEstablished,
  type GrowProviderEvidence,
} from '@/lib/payments/grow/providerEvidence'
import { GrowApiError, type GrowProcessTransaction } from '@/lib/payments/grow/api'
import { GrowTransportError } from '@/lib/payments/grow/http'

/**
 * LOCAL TEST DOUBLE — NOT SANDBOX EVIDENCE. The status code 'FIXTURE-SAVED' is
 * invented for this test so no real Grow status is implied to be verified.
 */
const LOCAL_TEST_EVIDENCE: GrowProviderEvidence = {
  tokenSaveVerification: { acceptedStatusCodes: ['FIXTURE-SAVED'], evidenceRef: 'LOCAL TEST DOUBLE — not sandbox evidence' },
  tokenChargeDispatch: { evidenceRef: null },
  tokenChargeReconciliation: { evidenceRef: null },
}

const tx = (over: Partial<GrowProcessTransaction> = {}): GrowProcessTransaction => ({
  transactionId: '287377',
  transactionToken: 'tt',
  statusCode: 'FIXTURE-SAVED',
  sum: '1',
  cardToken: 'ct-1',
  cardSuffix: '1234',
  cardBrand: 'Visa',
  cardExp: '1125',
  ...over,
})
const input = { processId: '462950', processToken: 'ptok', cardToken: 'ct-1' }

function verifier(result: GrowProcessTransaction[] | Error, evidence = LOCAL_TEST_EVIDENCE) {
  const getPaymentProcessInfo = vi.fn(async () => {
    if (result instanceof Error) throw result
    return result
  })
  return { verify: createGrowTokenSaveVerifier({ getPaymentProcessInfo, evidence }), getPaymentProcessInfo }
}

describe('provider evidence gates', () => {
  it('are all closed in the committed code: nothing provider-dependent is enabled without sandbox evidence', () => {
    expect(isTokenSaveVerificationEstablished()).toBe(false)
    expect(isTokenChargeDispatchEstablished()).toBe(false)
    expect(isTokenChargeReconciliationEstablished()).toBe(false)
    expect(GROW_PROVIDER_EVIDENCE.tokenSaveVerification.acceptedStatusCodes).toEqual([])
  })

  it('need both accepted codes and an evidence reference to open', () => {
    expect(isTokenSaveVerificationEstablished({ ...LOCAL_TEST_EVIDENCE, tokenSaveVerification: { acceptedStatusCodes: ['11'], evidenceRef: null } })).toBe(false)
    expect(isTokenSaveVerificationEstablished({ ...LOCAL_TEST_EVIDENCE, tokenSaveVerification: { acceptedStatusCodes: [], evidenceRef: 'x' } })).toBe(false)
  })
})

describe('createGrowTokenSaveVerifier', () => {
  it('fails closed without calling Grow while the evidence gate is closed', async () => {
    const { verify, getPaymentProcessInfo } = verifier([tx()], GROW_PROVIDER_EVIDENCE)
    expect(await verify(input)).toEqual({ kind: 'unavailable', reason: 'provider_evidence_missing' })
    expect(getPaymentProcessInfo).not.toHaveBeenCalled()
  })

  it('verifies from Grow facts, not from the callback', async () => {
    const { verify, getPaymentProcessInfo } = verifier([tx({ cardSuffix: '9999' })])
    expect(await verify(input)).toEqual({
      kind: 'verified',
      card: { cardToken: 'ct-1', cardSuffix: '9999', cardBrand: 'Visa', cardExp: '1125', setupTransactionId: '287377', setupTransactionToken: 'tt', setupStatusCode: 'FIXTURE-SAVED' },
    })
    expect(getPaymentProcessInfo).toHaveBeenCalledWith({ processId: '462950', processToken: 'ptok' })
  })

  it.each([
    ['the token is not in the process', [tx({ cardToken: 'other' })], 'token_not_in_process'],
    ['the process shows a paid transaction (documented "2")', [tx({ statusCode: '2' })], 'unexpected_status'],
    ['the sum is not the documented 1', [tx({ sum: '89' })], 'unexpected_sum'],
    ['the sum is missing', [tx({ sum: null })], 'unexpected_sum'],
  ])('refuses when %s', async (_label, transactions, reason) => {
    expect(await verifier(transactions).verify(input)).toEqual({ kind: 'refused', reason })
  })

  it.each([
    [new GrowTransportError('timeout'), 'transport_error'],
    [new GrowApiError(716, 'פרמטר קוד עסקה או תוקן אינו תקין'), 'provider_error'],
  ])('is unavailable, never refused or verified, on %s', async (err, reason) => {
    expect(await verifier(err).verify(input)).toEqual({ kind: 'unavailable', reason })
  })
})
