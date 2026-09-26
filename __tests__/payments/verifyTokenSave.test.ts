import { describe, it, expect, vi } from 'vitest'
import { type TokenSaveObservation, createGrowTokenSaveVerifier } from '@/lib/payments/cardTrial/verifyTokenSave'
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
  tokenSaveVerification: { sandbox: { acceptedStatusCodes: ['FIXTURE-SAVED'], evidenceRef: 'LOCAL TEST DOUBLE — not sandbox evidence' }, production: { acceptedStatusCodes: [], evidenceRef: null } },
  tokenChargeDispatch: { sandbox: { evidenceRef: null }, production: { evidenceRef: null } },
  tokenChargeReconciliation: { sandbox: { evidenceRef: null }, production: { evidenceRef: null } },
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
const input = { processId: '462950', processToken: 'ptok', cardToken: 'ct-1', agencyId: 1, mode: 'sandbox' as const }

function verifier(result: GrowProcessTransaction[] | Error, evidence = LOCAL_TEST_EVIDENCE) {
  const getPaymentProcessInfo = vi.fn(async () => {
    if (result instanceof Error) throw result
    return result
  })
  const observe = vi.fn(async (_agencyId: number, _observation: TokenSaveObservation) => {})
  return { verify: createGrowTokenSaveVerifier({ getPaymentProcessInfo, evidence, observe }), getPaymentProcessInfo, observe }
}

describe('a closed gate observes, and still grants nothing', () => {
  /**
   * The gate used to short-circuit before the lookup, which made it circular:
   * opening it needs the statusCode Grow returns for a token-only save, and
   * nothing was allowed to look.
   */
  const CLOSED = { tokenSaveVerification: { sandbox: { acceptedStatusCodes: [], evidenceRef: null }, production: { acceptedStatusCodes: [], evidenceRef: null } }, tokenChargeDispatch: { sandbox: { evidenceRef: null }, production: { evidenceRef: null } }, tokenChargeReconciliation: { sandbox: { evidenceRef: null }, production: { evidenceRef: null } } }
  const saved: GrowProcessTransaction[] = [
    { transactionId: 't1', transactionToken: 'tt', statusCode: '11', sum: '1', cardToken: 'TOKEN-SECRET-VALUE', cardSuffix: '4242', cardBrand: 'Visa', cardExp: '1230' },
  ]

  it('still asks Grow, and records what it saw', async () => {
    const v = verifier(saved, CLOSED)
    const out = await v.verify({ processId: 'p', processToken: 'pt', cardToken: 'TOKEN-SECRET-VALUE', agencyId: 7, mode: 'sandbox' as const })
    expect(v.getPaymentProcessInfo).toHaveBeenCalledTimes(1)
    expect(v.observe).toHaveBeenCalledWith(7, {
      statusCode: '11',
      sum: '1',
      cardTokenPresent: true,
      cardExpShape: 'NNNN',
      transactionCount: 1,
    })
    // Observation is not authorization.
    expect(out).toEqual({ kind: 'unavailable', reason: 'provider_evidence_missing' })
  })

  it('records no card token and no expiry digits', async () => {
    const v = verifier(saved, CLOSED)
    await v.verify({ processId: 'p', processToken: 'pt', cardToken: 'TOKEN-SECRET-VALUE', agencyId: 7, mode: 'sandbox' as const })
    const recorded = JSON.stringify(v.observe.mock.calls[0][1])
    expect(recorded).not.toContain('TOKEN-SECRET-VALUE')
    expect(recorded).not.toContain('1230')
    expect(recorded).not.toContain('4242')
  })

  it('a failed note never fails the verification', async () => {
    const getPaymentProcessInfo = vi.fn(async () => saved)
    const observe = vi.fn(async (_agencyId: number, _observation: TokenSaveObservation) => {
      throw new Error('analytics down')
    })
    const verify = createGrowTokenSaveVerifier({ getPaymentProcessInfo, evidence: CLOSED, observe })
    expect(await verify({ processId: 'p', processToken: 'pt', cardToken: 'TOKEN-SECRET-VALUE', agencyId: 7, mode: 'sandbox' as const })).toEqual({
      kind: 'unavailable',
      reason: 'provider_evidence_missing',
    })
  })
})

/** Sandbox token-save is OPEN in the committed evidence; this represents 'closed'. */
const CLOSED_EVIDENCE: GrowProviderEvidence = { tokenSaveVerification: { sandbox: { acceptedStatusCodes: [], evidenceRef: null }, production: { acceptedStatusCodes: [], evidenceRef: null } }, tokenChargeDispatch: { sandbox: { evidenceRef: null }, production: { evidenceRef: null } }, tokenChargeReconciliation: { sandbox: { evidenceRef: null }, production: { evidenceRef: null } } }

describe('provider evidence gates', () => {
  it('every production gate is open on executed evidence — which is still not permission to bill', () => {
    /*
     * The production save gate opened on 2026-09-25 from a real card save on
     * agency 103 (statusCode "11", sum "1", token present). What this case
     * guards is the separation that opening it must not blur: proving a card
     * can be SAVED proves nothing about charging it. Both money gates are
     * unexecuted in production and must stay shut until a real charge is
     * observed there.
     */
    expect(isTokenSaveVerificationEstablished('production')).toBe(true)
    expect(GROW_PROVIDER_EVIDENCE.tokenSaveVerification.production.acceptedStatusCodes).toEqual(['11'])
    expect(GROW_PROVIDER_EVIDENCE.tokenSaveVerification.production.evidenceRef).not.toBeNull()

    /*
     * Both money gates opened on 2026-09-26 from one executed ₪1 charge. An
     * EVIDENCE gate says the provider behaviour is known; it is not permission
     * to bill, which is SUBSCRIPTION_CHARGES_ENABLED and remains a separate,
     * global, currently-off switch. Keeping those two ideas apart is the thing
     * this case now guards.
     */
    expect(isTokenChargeDispatchEstablished('production')).toBe(true)
    expect(isTokenChargeReconciliationEstablished('production')).toBe(true)
    expect(GROW_PROVIDER_EVIDENCE.tokenChargeDispatch.production.evidenceRef).not.toBeNull()
    expect(GROW_PROVIDER_EVIDENCE.tokenChargeReconciliation.production.evidenceRef).not.toBeNull()

    expect(isTokenSaveVerificationEstablished('sandbox')).toBe(true)
  })

  it('need both accepted codes and an evidence reference to open', () => {
    expect(isTokenSaveVerificationEstablished('sandbox', { ...LOCAL_TEST_EVIDENCE, tokenSaveVerification: { sandbox: { acceptedStatusCodes: ['11'], evidenceRef: null }, production: { acceptedStatusCodes: [], evidenceRef: null } } })).toBe(false)
    expect(isTokenSaveVerificationEstablished('sandbox', { ...LOCAL_TEST_EVIDENCE, tokenSaveVerification: { sandbox: { acceptedStatusCodes: [], evidenceRef: 'x' }, production: { acceptedStatusCodes: [], evidenceRef: null } } })).toBe(false)
  })
})

describe('createGrowTokenSaveVerifier', () => {
  it('activates nothing while the evidence gate is closed — but DOES look, so the gate can be opened', async () => {
    const { verify, getPaymentProcessInfo } = verifier([tx()], CLOSED_EVIDENCE)
    expect(await verify(input)).toEqual({ kind: 'unavailable', reason: 'provider_evidence_missing' })
    // The lookup is read-only and moves no money. Skipping it was circular:
    // opening the gate needs the statusCode this call returns.
    expect(getPaymentProcessInfo).toHaveBeenCalledTimes(1)
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
