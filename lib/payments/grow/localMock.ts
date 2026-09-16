import type { CreateTokenProcessInput } from './api'
import type { TokenSaveVerification } from '@/lib/payments/cardTrial/verifyTokenSave'

/**
 * LOCAL DEMO MOCK OF GROW — never a provider, never evidence.
 *
 * It exists so the real routes, components and database lifecycle can be walked
 * through on a developer machine without contacting Grow. It does NOT touch the
 * provider-evidence gates (lib/payments/grow/providerEvidence.ts): those still
 * govern the REAL verifier, the real charge dispatch and reconciliation, and
 * stay closed. When this mock is off — which is everywhere except a local
 * machine that opts in — every path behaves exactly as before.
 *
 * FAILS CLOSED. All three must hold, or the mock does not exist:
 *   NODE_ENV !== 'production'   (never in a built/deployed app)
 *   APP_ENV === 'local'         (never staging, test or production)
 *   GROW_LOCAL_MOCK === 'true'  (explicit opt-in)
 */

export function isGrowLocalMockEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.APP_ENV === 'local' && process.env.GROW_LOCAL_MOCK === 'true'
}

/** Where the mocked hosted page and the callback live. Localhost only. */
export function localMockOrigin(): string {
  const origin = process.env.GROW_LOCAL_MOCK_ORIGIN || 'http://localhost:3002'
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : 'http://localhost:3002'
}

const MOCK_CARD = { cardToken: 'mock-card-token', cardSuffix: '4242', cardBrand: 'Visa', cardExp: '1230' }

/** Stands in for createPaymentProcess: returns a link to the mocked hosted page. */
export async function localMockCreateTokenOnlyProcess(input: CreateTokenProcessInput) {
  if (!isGrowLocalMockEnabled()) throw new Error('grow.local_mock.disabled')
  const processId = `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const processToken = `mocktok-${Math.random().toString(36).slice(2, 12)}`
  const url = new URL('/api/dev/grow-mock/pay', localMockOrigin())
  url.searchParams.set('processId', processId)
  url.searchParams.set('processToken', processToken)
  url.searchParams.set('reference', input.reference)
  url.searchParams.set('successUrl', input.successUrl)
  url.searchParams.set('cancelUrl', input.cancelUrl)
  return { processId, processToken, url: url.toString() }
}

/** Stands in for the getPaymentProcessInfo verification, including a refusal path. */
export async function localMockVerifyTokenSave(input: { cardToken: string }): Promise<TokenSaveVerification> {
  if (!isGrowLocalMockEnabled()) return { kind: 'unavailable', reason: 'provider_evidence_missing' }
  if (input.cardToken.startsWith('refused')) return { kind: 'refused', reason: 'unexpected_status' }
  return {
    kind: 'verified',
    card: { ...MOCK_CARD, cardToken: input.cardToken, setupTransactionId: 'mock-tx', setupTransactionToken: 'mock-tx-token', setupStatusCode: 'MOCK-SAVED' },
  }
}

export const MOCK_CARD_TOKEN = MOCK_CARD.cardToken
