import { GrowApiError, getPaymentProcessInfo } from '@/lib/payments/grow/api'
import { GrowTransportError } from '@/lib/payments/grow/http'
import { GROW_PROVIDER_EVIDENCE, isTokenSaveVerificationEstablished, type GrowProviderEvidence } from '@/lib/payments/grow/providerEvidence'
import type { ConfirmedCard } from '@/db/payments/paymentMethods'
import { TOKEN_SAVE_SUM } from './terms'

/**
 * The single place that decides whether Grow really saved a card token without
 * capturing money. A small adapter on purpose: the provider semantics it relies
 * on are unverified (Gate B), so it fails closed.
 *
 *   unavailable  — cannot decide now (no sandbox evidence yet, or Grow/transport
 *                  error). Nothing is activated.
 *   refused      — Grow answered and it is NOT a clean token save (token missing
 *                  from the process, unexpected sum or status — e.g. a capture).
 *   verified     — card facts exactly as GROW reported them.
 *
 * The callback body is never evidence: every fact comes from
 * getPaymentProcessInfo called with our credentials.
 */

export type TokenSaveRefusal = 'token_not_in_process' | 'unexpected_sum' | 'unexpected_status'
export type TokenSaveUnavailable = 'provider_evidence_missing' | 'provider_error' | 'transport_error'

export type TokenSaveVerification =
  | { kind: 'verified'; card: ConfirmedCard }
  | { kind: 'refused'; reason: TokenSaveRefusal }
  | { kind: 'unavailable'; reason: TokenSaveUnavailable }

export type TokenSaveVerifier = (input: { processId: string; processToken: string; cardToken: string }) => Promise<TokenSaveVerification>

export function createGrowTokenSaveVerifier(
  deps: { getPaymentProcessInfo: typeof getPaymentProcessInfo; evidence: GrowProviderEvidence } = {
    getPaymentProcessInfo,
    evidence: GROW_PROVIDER_EVIDENCE,
  },
): TokenSaveVerifier {
  return async ({ processId, processToken, cardToken }) => {
    if (!isTokenSaveVerificationEstablished(deps.evidence)) return { kind: 'unavailable', reason: 'provider_evidence_missing' }

    let transactions
    try {
      transactions = await deps.getPaymentProcessInfo({ processId, processToken })
    } catch (err) {
      if (err instanceof GrowTransportError) return { kind: 'unavailable', reason: 'transport_error' }
      if (err instanceof GrowApiError) return { kind: 'unavailable', reason: 'provider_error' }
      throw err
    }

    const tx = transactions.find((t) => t.cardToken === cardToken)
    if (!tx) return { kind: 'refused', reason: 'token_not_in_process' }
    if (tx.sum === null || Number(tx.sum) !== TOKEN_SAVE_SUM) return { kind: 'refused', reason: 'unexpected_sum' }
    if (tx.statusCode === null || !deps.evidence.tokenSaveVerification.acceptedStatusCodes.includes(tx.statusCode)) {
      return { kind: 'refused', reason: 'unexpected_status' }
    }

    return {
      kind: 'verified',
      card: {
        cardToken,
        cardSuffix: tx.cardSuffix,
        cardBrand: tx.cardBrand,
        cardExp: tx.cardExp,
        setupTransactionId: tx.transactionId,
        setupTransactionToken: tx.transactionToken,
        setupStatusCode: tx.statusCode,
      },
    }
  }
}

export const verifyTokenSaveWithGrow: TokenSaveVerifier = createGrowTokenSaveVerifier()
