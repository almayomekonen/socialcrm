/**
 * Grow behaviour this integration depends on that the documentation does not
 * establish (spec §9, plan Amendment A2/A7). Each gate below keeps the
 * behaviour that depends on it DISABLED — fail closed — until sandbox evidence
 * has been recorded in the Gate B evidence log and referenced here.
 *
 * Never open a gate from a local mock, a documentation example, or a support
 * answer alone. Tests inject their own evidence objects instead of editing this.
 */

export type GrowProviderEvidence = {
  tokenSaveVerification: {
    /**
     * getPaymentProcessInfo statusCodes that mean "card token saved, nothing
     * captured". The docs show "11" (עסקה מושהית) only in a callback example,
     * and the only documented process-info example is a PAID transaction.
     */
    acceptedStatusCodes: readonly string[]
    evidenceRef: string | null
  }
  /** createTransactionWithToken success shape and duplicate-identifier behaviour observed. */
  tokenChargeDispatch: { evidenceRef: string | null }
  /** getTokenTransactionsByExternalIdentifiers response shape observed (its response is undocumented). */
  tokenChargeReconciliation: { evidenceRef: string | null }
}

export const GROW_PROVIDER_EVIDENCE: GrowProviderEvidence = {
  tokenSaveVerification: { acceptedStatusCodes: [], evidenceRef: null },
  tokenChargeDispatch: { evidenceRef: null },
  tokenChargeReconciliation: { evidenceRef: null },
}

export function isTokenSaveVerificationEstablished(e: GrowProviderEvidence = GROW_PROVIDER_EVIDENCE): boolean {
  return e.tokenSaveVerification.evidenceRef !== null && e.tokenSaveVerification.acceptedStatusCodes.length > 0
}

export function isTokenChargeDispatchEstablished(e: GrowProviderEvidence = GROW_PROVIDER_EVIDENCE): boolean {
  return e.tokenChargeDispatch.evidenceRef !== null
}

export function isTokenChargeReconciliationEstablished(e: GrowProviderEvidence = GROW_PROVIDER_EVIDENCE): boolean {
  return e.tokenChargeReconciliation.evidenceRef !== null
}
