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
  tokenChargeDispatch: { sandbox: { evidenceRef: string | null }; production: { evidenceRef: string | null } }
  /** getTokenTransactionsByExternalIdentifiers response shape observed (undocumented). */
  tokenChargeReconciliation: { sandbox: { evidenceRef: string | null }; production: { evidenceRef: string | null } }
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
 * SECOND REPLY, same day, after the submission was sent:
 *
 *  4. "Send only ONE of transactionUniqueIdentifier or
 *     transactionGroupIdentifier."  createTransactionWithToken now carries the
 *     unique one and omits the group one entirely (lib/payments/grow/api.ts).
 *  5. ApproveTransaction is NOT required for our use case — asked and answered.
 *     Closed; not to be raised with Grow again.
 *  6. The website has been forwarded for review. PENDING, not approved.
 *
 * HISTORY IS NOT REWRITTEN. The sandbox evidence run of 2026-09-17
 * (transactionId 549236, and the 1010 refusal of its repeat) was sent BEFORE
 * item 4 arrived and carried BOTH identifiers. That is what happened. The
 * duplicate refusal keyed on the unique identifier either way, which is why the
 * corrected payload keeps that one.
 *
 * WHAT THIS STILL DOES NOT COVER. It says nothing about the PRODUCTION account,
 * which is a different business profile issued only after Grow's review. A
 * written clarification is not execution evidence: production gates stay closed
 * until a real production charge is observed, and an authorization-shaped or
 * ambiguous response is never read as paid.
 */
export const GROW_SUPPORT_CONFIRMATIONS = {
  environment: 'test' as const,
  approveTransactionRequired: false,
  tokenSaveIsAuthorizationHoldOnly: true,
  holdReleasedWithinDays: 10,
  /** Exactly one identifier per token charge; we send transactionUniqueIdentifier. */
  tokenChargeIdentifierCount: 1 as const,
  /** Grow received the site for review on 2026-09-17. Not an approval. */
  websiteReview: 'pending' as const,
  /** Issued only after the review passes. */
  productionCredentials: 'pending' as const,
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
    /**
     * OPENED 2026-09-25 from a real production save by the owner (agency 103,
     * purpose card_update, setup process 351551…).
     *
     * getPaymentProcessInfo, called with our PRODUCTION credentials, returned
     * the same shape eleven times while the return page polled — statusCode
     * "11", sum "1", one transaction, a cardToken present, cardExp MMYY:
     *
     *   card_save_observed@2026-09-25T15:26:25Z … 15:26:56Z (agency 103)
     *
     * That is an authorization hold with a token saved and nothing captured,
     * which is what Grow documents for "Get Token Only" and what sandbox
     * returned — now observed on the production account rather than inferred
     * from it. The repetition is not eleven card saves: it is one save, re-read
     * by each poll, which is itself evidence that the response is stable.
     *
     * THIS OPENS EXACTLY ONE GATE. Charging and reconciliation have still never
     * been executed in production and stay closed below: a card that can be
     * saved is not a card that has been proven billable.
     */
    production: { acceptedStatusCodes: ['11'], evidenceRef: 'card_save_observed@2026-09-25T15:26:56Z' },
  },
  /**
   * Observed on the sandbox account 2026-09-17, agency 6 / card 11 (Grow's
   * documented test card): one ₪1 createTransactionWithToken returned
   * kind "paid", statusCode 2, transactionId 549236, with an asmachta; the same
   * transactionUniqueIdentifier sent again was refused with error 1010
   * ("מזהה עסקה יחודי כבר קיים עבור בית העסק").
   */
  tokenChargeDispatch: { sandbox: { evidenceRef: 'charge_probe@2026-09-17:tx549236+dup1010' }, production: { evidenceRef: null } },
  /**
   * Same run: the lookup returned status 1 with exactly one transaction —
   * statusCode 2, transactionId 549236, sum "1". Only that case is established;
   * see interpretTokenLookup, which answers `undetermined` for everything else.
   */
  tokenChargeReconciliation: { sandbox: { evidenceRef: 'charge_probe@2026-09-17:lookup-shape' }, production: { evidenceRef: null } },
}

export function isTokenSaveVerificationEstablished(mode: GrowMode, e: GrowProviderEvidence = GROW_PROVIDER_EVIDENCE): boolean {
  const ev = e.tokenSaveVerification[mode]
  return ev.evidenceRef !== null && ev.acceptedStatusCodes.length > 0
}

export function acceptedTokenSaveStatusCodes(mode: GrowMode, e: GrowProviderEvidence = GROW_PROVIDER_EVIDENCE): readonly string[] {
  return e.tokenSaveVerification[mode].acceptedStatusCodes
}

export function isTokenChargeDispatchEstablished(mode: GrowMode, e: GrowProviderEvidence = GROW_PROVIDER_EVIDENCE): boolean {
  return e.tokenChargeDispatch[mode].evidenceRef !== null
}

export function isTokenChargeReconciliationEstablished(mode: GrowMode, e: GrowProviderEvidence = GROW_PROVIDER_EVIDENCE): boolean {
  return e.tokenChargeReconciliation[mode].evidenceRef !== null
}
