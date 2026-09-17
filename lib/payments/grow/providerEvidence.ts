/**
 * Grow behaviour this integration depends on that the documentation does not
 * establish (spec §9, plan Amendment A2/A7). Each gate below keeps the
 * behaviour that depends on it DISABLED — fail closed — until sandbox evidence
 * has been recorded in the Gate B evidence log and referenced here.
 *
 * Never open a gate from a local mock, a documentation example, or a support
 * answer alone. Tests inject their own evidence objects instead of editing this.
 */

export type TokenSaveEvidence = {
  /**
   * getPaymentProcessInfo statusCodes that mean "card token saved, nothing
   * captured". The docs show "11" (עסקה מושהית) only in a callback example,
   * and the only documented process-info example is a PAID transaction.
   */
  acceptedStatusCodes: readonly string[]
  evidenceRef: string | null
}

import type { GrowMode } from './config'

export type GrowProviderEvidence = {
  /**
   * PER ENVIRONMENT, and deliberately so. A statusCode observed in sandbox is
   * evidence about sandbox. Production identifiers are issued only after Grow's
   * review, against a different account, and nothing observed here establishes
   * what that account returns — still less what it does with the ₪1.
   */
  tokenSaveVerification: { sandbox: TokenSaveEvidence; production: TokenSaveEvidence }
  /** createTransactionWithToken success shape and duplicate-identifier behaviour observed. */
  tokenChargeDispatch: { evidenceRef: string | null }
  /** getTokenTransactionsByExternalIdentifiers response shape observed (its response is undocumented). */
  tokenChargeReconciliation: { evidenceRef: string | null }
}

/**
 * Grow support, in writing, 2026-09-17 — closes three items that were open:
 *
 *  1. "The identifiers are for the test environment."  Matches what the
 *     credential check found on 2026-09-16: sandbox created a hosted page,
 *     production refused with error 701 naming userId.
 *  2. "ApproveTransaction is not required in this case."  It stays absent from
 *     token-only saving and token charges, now by confirmation rather than by
 *     caution.
 *  3. "Token saving without charging is an authorization hold only, released
 *     within 10 days."  This is the ₪1 answer. A HOLD, not a capture — so the
 *     customer is told it may appear and that it clears (TOKEN_HOLD_NOTICE),
 *     and it is never described as a subscription charge.
 *
 * It says nothing about the PRODUCTION account, which is a different business
 * profile issued after Grow's review. Production gates stay closed.
 */
export const GROW_SUPPORT_CONFIRMATIONS = {
  environment: 'test' as const,
  approveTransactionRequired: false,
  tokenSaveIsAuthorizationHoldOnly: true,
  holdReleasedWithinDays: 10,
  confirmedAt: '2026-09-17',
} as const

export const GROW_PROVIDER_EVIDENCE: GrowProviderEvidence = {
  tokenSaveVerification: {
    /**
     * Observed twice on the sandbox account, 2026-09-16T21:13:32Z and
     * 21:15:26Z, from two independent real card saves by the owner:
     * statusCode "11", sum "1", a cardToken present, cardExp MMYY, one
     * transaction in the process. Recorded as `card_save_observed` analytics
     * events (agency 2) — the sanitized evidence log, no token or PAN.
     * That matches Grow's documented token-save example exactly.
     */
    sandbox: { acceptedStatusCodes: ['11'], evidenceRef: 'card_save_observed@2026-09-16T21:15:26Z' },
    /** Closed. No production identifiers exist, so nothing has been observed. */
    production: { acceptedStatusCodes: [], evidenceRef: null },
  },
  tokenChargeDispatch: { evidenceRef: null },
  tokenChargeReconciliation: { evidenceRef: null },
}

export function isTokenSaveVerificationEstablished(mode: GrowMode, e: GrowProviderEvidence = GROW_PROVIDER_EVIDENCE): boolean {
  const ev = e.tokenSaveVerification[mode]
  return ev.evidenceRef !== null && ev.acceptedStatusCodes.length > 0
}

export function acceptedTokenSaveStatusCodes(mode: GrowMode, e: GrowProviderEvidence = GROW_PROVIDER_EVIDENCE): readonly string[] {
  return e.tokenSaveVerification[mode].acceptedStatusCodes
}

export function isTokenChargeDispatchEstablished(e: GrowProviderEvidence = GROW_PROVIDER_EVIDENCE): boolean {
  return e.tokenChargeDispatch.evidenceRef !== null
}

export function isTokenChargeReconciliationEstablished(e: GrowProviderEvidence = GROW_PROVIDER_EVIDENCE): boolean {
  return e.tokenChargeReconciliation.evidenceRef !== null
}
