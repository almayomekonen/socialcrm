import { db } from '@/config/db'
import { safeEqual } from '@/lib/payments/grow/constantTime'
import type { GrowMode } from '@/lib/payments/grow/config'
import type { GrowCallback } from '@/lib/payments/grow/callbackPayload'
import { startTrialInTransaction } from '@/db/trial'
import {
  activatePaymentMethod,
  decryptSetupProcessToken,
  findPaymentMethodBySetupProcessId,
  markPaymentMethodStatus,
  recordCallbackReceived,
  type PaymentMethodPurpose,
  type PaymentMethodStatus,
} from '@/db/payments/paymentMethods'
import { scheduleImmediateAttemptForOpenPeriod } from '@/db/payments/chargeScheduling'
import type { TokenSaveRefusal, TokenSaveVerifier } from './verifyTokenSave'
import { CARD_TRIAL_PERIOD } from './terms'

/**
 * Turns a Grow token-save callback into a confirmed card — and, for a trial
 * start, a started trial — or changes nothing.
 *
 * CORRELATION. The callback must name a process WE created (processId), present
 * its processToken (constant-time compare; Grow forbids revealing it to the
 * payer), carry our reference when it carries one, match the setup's Grow mode,
 * and the user who opened the setup must still belong to that agency.
 *
 * VERIFICATION. Nothing is activated from the callback body. The verifier
 * re-reads the process from Grow and fails closed while the provider semantics
 * are unproven (providerEvidence) — the callback is then recorded and the setup
 * stays pending.
 *
 * NO REVIVAL. The confirming transaction locks the subscription row first (the
 * order cancellation uses) and activates only a still-PENDING setup, so a
 * duplicate, a superseded setup, or one invalidated by a cancellation changes
 * nothing. A trial start never modifies an existing subscription, and the trial
 * write point never moves an existing trial clock.
 */

export type ConfirmOutcome =
  | { kind: 'confirmed'; agencyId: number; purpose: PaymentMethodPurpose; createdByUserId: number | null; trialStarted: boolean }
  | { kind: 'already_processed'; agencyId: number; status: PaymentMethodStatus }
  | { kind: 'rejected'; httpStatus: 400 | 401; reason: string }
  | { kind: 'refused'; agencyId: number; reason: TokenSaveRefusal | 'setup_owner_changed' }
  | { kind: 'awaiting_evidence'; agencyId: number }
  | { kind: 'retry_later'; agencyId: number; reason: string }

export type ConfirmDeps = { verify: TokenSaveVerifier; runtimeMode: () => GrowMode }

async function ownerStillInAgency(userId: number | null, agencyId: number): Promise<boolean> {
  if (userId === null) return false
  const user = await db('users').where({ id: userId }).first('agencyId')
  return Number(user?.agencyId) === agencyId
}

export async function confirmCardSetup(callback: GrowCallback, deps: ConfirmDeps): Promise<ConfirmOutcome> {
  const { processId, processToken, cardToken } = callback
  if (!processId || !processToken || !cardToken) return { kind: 'rejected', httpStatus: 400, reason: 'missing_fields' }

  const method = await findPaymentMethodBySetupProcessId(processId)
  if (!method || !method.setupProcessTokenEnc) return { kind: 'rejected', httpStatus: 401, reason: 'unknown_process' }
  if (!safeEqual(decryptSetupProcessToken(method), processToken)) return { kind: 'rejected', httpStatus: 401, reason: 'process_token_mismatch' }
  if (callback.reference && callback.reference !== method.reference) return { kind: 'rejected', httpStatus: 401, reason: 'reference_mismatch' }
  if (method.providerMode !== deps.runtimeMode()) return { kind: 'rejected', httpStatus: 401, reason: 'mode_mismatch' }

  const agencyId = method.agencyId
  if (method.status !== 'pending') return { kind: 'already_processed', agencyId, status: method.status }
  if (!(await ownerStillInAgency(method.createdByUserId, agencyId))) {
    await markPaymentMethodStatus(db, method.id, 'needs_review', 'setup_owner_changed')
    return { kind: 'refused', agencyId, reason: 'setup_owner_changed' }
  }

  const verification = await deps.verify({ processId, processToken, cardToken })
  if (verification.kind === 'unavailable') {
    await recordCallbackReceived(method.id, verification.reason)
    return verification.reason === 'provider_evidence_missing'
      ? { kind: 'awaiting_evidence', agencyId }
      : { kind: 'retry_later', agencyId, reason: verification.reason }
  }
  if (verification.kind === 'refused') {
    await markPaymentMethodStatus(db, method.id, 'needs_review', verification.reason)
    return { kind: 'refused', agencyId, reason: verification.reason }
  }

  const result = await db.transaction(async (trx) => {
    await trx('subscriptions').where({ agencyId }).forUpdate().first('id')
    if (!(await activatePaymentMethod(trx, method, verification.card))) return null

    if (method.purpose === 'trial_start') {
      const inserted = await trx.raw(
        `INSERT INTO subscriptions ("agencyId", "cancelAtPeriodEnd", "billingPeriod", "createdAt", "updatedAt")
         VALUES (?, false, ?, now(), now())
         ON CONFLICT ("agencyId") DO NOTHING`,
        [agencyId, CARD_TRIAL_PERIOD],
      )
      if (inserted.rowCount === 0) console.warn('[CardSetup] existing subscription kept unchanged on trial start', { agencyId })
      return { trialStarted: await startTrialInTransaction(trx, agencyId) }
    }

    if (method.purpose === 'reactivate') {
      await trx('subscriptions').where({ agencyId }).update({ cancelAtPeriodEnd: false, updatedAt: new Date() })
    }
    await scheduleImmediateAttemptForOpenPeriod(trx, agencyId, method.id)
    return { trialStarted: false }
  })

  if (!result) {
    const current = await findPaymentMethodBySetupProcessId(processId)
    return { kind: 'already_processed', agencyId, status: current?.status ?? method.status }
  }
  return { kind: 'confirmed', agencyId, purpose: method.purpose, createdByUserId: method.createdByUserId, trialStarted: result.trialStarted }
}
