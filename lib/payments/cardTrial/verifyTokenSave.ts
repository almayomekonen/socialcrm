import { GrowApiError, getPaymentProcessInfo } from '@/lib/payments/grow/api'
import { GrowTransportError } from '@/lib/payments/grow/http'
import { GROW_PROVIDER_EVIDENCE, acceptedTokenSaveStatusCodes, isTokenSaveVerificationEstablished, type GrowProviderEvidence } from '@/lib/payments/grow/providerEvidence'
import type { GrowMode } from '@/lib/payments/grow/config'
import type { ConfirmedCard } from '@/db/payments/paymentMethods'
import { TOKEN_SAVE_SUM } from './terms'
import { track } from '@/lib/analytics/track'

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
 *
 * OBSERVATION IS NOT AUTHORIZATION. The evidence gate used to short-circuit
 * before the lookup, which made it circular: opening it needs the statusCode
 * Grow returns for a token-only save, and nothing was allowed to look. So the
 * lookup now runs FIRST — it is a read-only query that moves no money — and its
 * shape is recorded. The gate is applied afterwards and still decides whether
 * anything is activated, so a closed gate collects evidence and grants nothing.
 */

export type TokenSaveRefusal = 'token_not_in_process' | 'unexpected_sum' | 'unexpected_status'
export type TokenSaveUnavailable = 'provider_evidence_missing' | 'provider_error' | 'transport_error' | 'provider_not_configured'

export type TokenSaveVerification =
  | { kind: 'verified'; card: ConfirmedCard }
  | { kind: 'refused'; reason: TokenSaveRefusal }
  | { kind: 'unavailable'; reason: TokenSaveUnavailable }

export type TokenSaveVerifier = (input: {
  processId: string
  processToken: string
  cardToken: string
  agencyId: number
  /** Evidence is per environment: sandbox observations never speak for production. */
  mode: GrowMode
}) => Promise<TokenSaveVerification>

/**
 * What a token-only save looked like, recorded so the gate can later be opened
 * from a real observation. Deliberately shape-only: no card token, no PAN, and
 * the expiry reduced to its shape — enough to answer "which statusCode means
 * saved, not captured", and nothing that could charge or identify a card.
 */
export type TokenSaveObservation = {
  statusCode: string | null
  sum: string | number | null
  cardTokenPresent: boolean
  cardExpShape: string | null
  transactionCount: number
}

export type ObserveTokenSave = (agencyId: number, observation: TokenSaveObservation) => Promise<void>

export function createGrowTokenSaveVerifier(
  deps: {
    getPaymentProcessInfo: typeof getPaymentProcessInfo
    evidence: GrowProviderEvidence
    observe: ObserveTokenSave
  } = {
    getPaymentProcessInfo,
    evidence: GROW_PROVIDER_EVIDENCE,
    observe: recordTokenSaveObservation,
  },
): TokenSaveVerifier {
  return async ({ processId, processToken, cardToken, agencyId, mode }) => {
    // Read-only, moves no money, and runs whatever the gate says — this is the
    // only way the gate can ever be opened from a real save.
    let transactions
    try {
      transactions = await deps.getPaymentProcessInfo({ processId, processToken })
    } catch (err) {
      if (err instanceof GrowTransportError) return { kind: 'unavailable', reason: 'transport_error' }
      if (err instanceof GrowApiError) return { kind: 'unavailable', reason: 'provider_error' }
      // No identifiers / no usable mode: the lookup cannot even be addressed.
      // Fail closed like every other unavailable, so the callback is recorded
      // and Grow is asked to retry — never a 500 that looks like our bug.
      if (String(err).startsWith('Error: grow.config.')) return { kind: 'unavailable', reason: 'provider_not_configured' }
      throw err
    }

    const observed = transactions.find((t) => t.cardToken === cardToken) ?? transactions[0]
    try {
      await deps.observe(agencyId, {
        statusCode: observed?.statusCode ?? null,
        sum: observed?.sum ?? null,
        cardTokenPresent: Boolean(observed?.cardToken),
        cardExpShape: observed?.cardExp ? observed.cardExp.replace(/\d/g, 'N') : null,
        transactionCount: transactions.length,
      })
    } catch (err) {
      // Never fail a verification because the note could not be written.
      console.error('[CardSetup] token-save observation not recorded', { agencyId, err: String(err) })
    }

    // Gate applied AFTER the observation: evidence first, authorization second.
    if (!isTokenSaveVerificationEstablished(mode, deps.evidence)) return { kind: 'unavailable', reason: 'provider_evidence_missing' }

    const tx = transactions.find((t) => t.cardToken === cardToken)
    if (!tx) return { kind: 'refused', reason: 'token_not_in_process' }
    if (tx.sum === null || Number(tx.sum) !== TOKEN_SAVE_SUM) return { kind: 'refused', reason: 'unexpected_sum' }
    if (tx.statusCode === null || !acceptedTokenSaveStatusCodes(mode, deps.evidence).includes(tx.statusCode)) {
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

/**
 * Written to analytics_events, which already exists and is queryable — no new
 * table for a note that is read a handful of times. Contains nothing secret.
 */
export const recordTokenSaveObservation: ObserveTokenSave = async (agencyId, observation) => {
  await track({ agencyId, event: 'card_save_observed', props: { ...observation } })
}

export const verifyTokenSaveWithGrow: TokenSaveVerifier = createGrowTokenSaveVerifier()
