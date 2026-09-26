import { getPaymentProcessInfo } from '@/lib/payments/grow/api'
import { assertGrowRuntime } from '@/lib/payments/grow/config'
import { decryptSetupProcessToken, getLatestPaymentMethod } from '@/db/payments/paymentMethods'
import { confirmCardSetup, type ConfirmOutcome } from './confirmCardSetup'
import { verifyTokenSaveWithGrow } from './verifyTokenSave'
import { getCardSetupStateForAgency, type CardSetupState } from './setupStatus'

/**
 * Finish a setup whose callback already arrived but could not be verified then —
 * the evidence gate was closed at that moment, so the card was saved at Grow and
 * the trial never started.
 *
 * Nothing is forged. The card facts are re-read from Grow with our own
 * credentials (getPaymentProcessInfo), and the result goes through the SAME
 * confirmCardSetup the callback uses: the process token is compared in constant
 * time, the mode must match, the row must still be `pending`, and activation is
 * the one idempotent transaction. Running this twice cannot start two trials —
 * the second pass finds the row no longer pending and answers already_processed.
 *
 * Scoped by agencyId throughout: the row is loaded BY agency, so one agency can
 * never recover another's setup.
 */
export type RecoverOutcome = ConfirmOutcome | { kind: 'nothing_to_recover' } | { kind: 'no_token_in_process' }

export async function recoverPendingCardSetup(
  agencyId: number,
  deps = { getPaymentProcessInfo, verify: verifyTokenSaveWithGrow },
): Promise<RecoverOutcome> {
  // Through the mapper, never a raw row: the column is `setupProcessToken` and
  // the mapped field is `setupProcessTokenEnc`, so a raw row cast to the type
  // looks fine to the compiler and then cannot be decrypted.
  const method = await getLatestPaymentMethod(agencyId)
  if (!method || method.status !== 'pending' || !method.setupProcessId || !method.setupProcessTokenEnc || !method.lastCallbackAt) {
    return { kind: 'nothing_to_recover' }
  }

  const runtime = assertGrowRuntime()
  const processToken = decryptSetupProcessToken(method)
  const transactions = await deps.getPaymentProcessInfo({ processId: method.setupProcessId, processToken })
  const cardToken = transactions.find((t) => t.cardToken)?.cardToken
  if (!cardToken) return { kind: 'no_token_in_process' }

  return confirmCardSetup(
    {
      processId: method.setupProcessId,
      processToken,
      cardToken,
      reference: method.reference,
      // Not from a callback: every card fact is re-read from Grow inside
      // verifyTokenSave, which is the only thing confirmCardSetup trusts.
      transactionId: null,
      transactionToken: null,
      statusCode: null,
      sum: null,
      cardSuffix: null,
      cardBrand: null,
      cardExp: null,
    },
    { verify: deps.verify, runtimeMode: () => runtime.mode },
  )
}

/**
 * Read the setup state, finishing a recoverable one first.
 *
 * A save whose callback arrived while the evidence gate was shut sits at
 * 'pending' forever unless something asks again — Grow does not resend an
 * update it already got a 200 for. Until now the only thing that asked was the
 * Grow return page's poll, so once the customer navigated away from it the
 * attempt could only be revived by returning to a URL they no longer had. The
 * billing centre, the one page they DO come back to, showed them the
 * add-a-card form instead, which reads as "your save didn't happen" and invites
 * a second card entry that supersedes the first.
 *
 * So this is the shared entry point: the return page's poll and the billing
 * page both call it. Recovery itself is unchanged — the same verified,
 * idempotent path (recoverPendingCardSetup, then confirmCardSetup), agency
 * scoped, forging nothing. A failure never fails the caller; it returns the
 * true current state, which is what it was going to show anyway.
 */
export async function refreshCardSetupState(agencyId: number): Promise<CardSetupState> {
  const current = await getCardSetupStateForAgency(agencyId)
  if (current.state !== 'verifying' || !current.callbackReceived) return current
  try {
    await recoverPendingCardSetup(agencyId)
  } catch (err) {
    console.error('[CardSetup] recovery attempt failed', { agencyId, err: String(err) })
    return current
  }
  return await getCardSetupStateForAgency(agencyId)
}
