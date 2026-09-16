import { getPaymentProcessInfo } from '@/lib/payments/grow/api'
import { assertGrowRuntime } from '@/lib/payments/grow/config'
import { decryptSetupProcessToken, getLatestPaymentMethod } from '@/db/payments/paymentMethods'
import { confirmCardSetup, type ConfirmOutcome } from './confirmCardSetup'
import { verifyTokenSaveWithGrow } from './verifyTokenSave'

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
