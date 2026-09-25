import { randomBytes } from 'crypto'
import { db } from '@/config/db'
import { isAdmin, type Roles } from '@/types/roles'
import { getAgencyTrial } from '@/db/trial'
import { getTrialState } from '@/lib/trial'
import { track } from '@/lib/analytics/track'
import { createTokenOnlyProcess, type CardHolder } from '@/lib/payments/grow/api'
import { assertGrowRuntime, isCardRequiredTrialEnabledForAgency, publicAppOrigin } from '@/lib/payments/grow/config'
import {
  attachSetupProcess,
  createPendingPaymentMethod,
  getActivePaymentMethod,
  getLatestConfirmedPaymentMethod,
  markPaymentMethodStatus,
  supersedePendingPaymentMethods,
  type PaymentMethodPurpose,
} from '@/db/payments/paymentMethods'
import { isGrowLocalMockEnabled, localMockCreateTokenOnlyProcess, localMockOrigin } from '@/lib/payments/grow/localMock'
import { validateCardHolder } from './cardHolder'
import { CARD_STORAGE_CONSENT_VERSION, CARD_TRIAL_TERMS_VERSION, TOKEN_PROCESS_DESCRIPTION } from './terms'

/**
 * Opens a Grow "Get Token Only" payment page for this agency. Nothing here
 * starts a trial, un-cancels a subscription or grants anything: that happens
 * only when Grow's callback is VERIFIED (confirmCardSetup).
 *
 * TWO CONSENTS. Grow's hosted page asks the customer to approve saving the card.
 * Agreement to the subscription itself (7-day trial, then ₪89 charged
 * automatically every month until cancelled) is ours, recorded here as the
 * accepted terms version; a trial start or reactivation without it is refused.
 * Replacing the card on an existing subscription does not change the agreement.
 */

export type CardSetupRequester = { id: number; agencyId: number; email: string | null; role: Roles }
export type StartCardSetupInput = { purpose: PaymentMethodPurpose; fullName?: string; phone?: string; acceptedTerms?: boolean; acceptedCardStorage?: boolean }
export type StartCardSetupResult =
  | { ok: true; url: string }
  | { error: 'unauthorized' | 'not_eligible' | 'provider_unavailable' | 'terms_required' | 'card_storage_consent_required' }
  | { error: 'invalid_holder'; field: 'fullName' | 'phone'; message: string }

/** /billing/success?source=… — decides which verifier copy the customer sees. */
export const SUCCESS_SOURCE: Record<PaymentMethodPurpose, string> = {
  trial_start: 'card_trial',
  card_update: 'card_update',
  reactivate: 'reactivate',
}

const needsTerms = (purpose: PaymentMethodPurpose) => purpose !== 'card_update'

/**
 * Exported so a surface can offer exactly what this server action will accept.
 * A CTA the request would refuse is a dead end, and with Payment Links gone
 * there is no second way to pay to fall back to.
 */
export async function isCardSetupEligible(agencyId: number, purpose: PaymentMethodPurpose): Promise<boolean> {
  const row = await getAgencyTrial(agencyId)
  if (!row) return false
  const status = getTrialState(row, new Date()).status
  if (purpose === 'trial_start') {
    if (!isCardRequiredTrialEnabledForAgency(agencyId)) return false
    // NEVER_STARTED is the normal case. TRIAL_ACTIVE-without-a-card is the
    // customer who began a trial before a card was required: with Payment Links
    // gone they would otherwise have no way to pay, ever. Saving a card here
    // cannot move their clock — startTrialInTransaction only writes when
    // trialStartedAt IS NULL — and schedules no immediate charge; the ordinary
    // trial-end conversion picks them up once a card is active.
    if (status === 'NEVER_STARTED') return true
    return status === 'TRIAL_ACTIVE' && (await getActivePaymentMethod(agencyId)) === null
  }
  if (purpose === 'card_update') {
    if ((await getActivePaymentMethod(agencyId)) !== null) return true
    /**
     * ADDING A FIRST CARD TO AN ALREADY-ENTITLED ACCOUNT.
     *
     * The three purposes assumed a card either exists (card_update), is about
     * to start a trial (trial_start), or is being restored after one expired
     * (reactivate). An account that is PAID or LEGACY with no card on file
     * matched none of them and could never add one — which is exactly how a
     * manually granted Pro workspace (planReason 'manual:owner-comp') ends up
     * on a billing screen that offers it nothing.
     *
     * PAID and LEGACY only, deliberately. TRIAL_ACTIVE-without-a-card is
     * already trial_start's case and must stay there: that customer IS
     * converting at ₪89 and has to accept the subscription terms, which this
     * purpose does not ask for.
     *
     * Gated on the rollout flag like every other card path, so the validation
     * window stays restricted to the allowlisted account.
     */
    if (!isCardRequiredTrialEnabledForAgency(agencyId)) return false
    return status === 'PAID' || status === 'LEGACY'
  }
  return status === 'TRIAL_EXPIRED' && (await getLatestConfirmedPaymentMethod(agencyId)) !== null
}

type HolderResult = { ok: true; holder: CardHolder } | { ok: false; field: 'fullName' | 'phone'; message: string }

async function resolveHolder(requester: CardSetupRequester, input: StartCardSetupInput): Promise<HolderResult> {
  const typed = input.purpose === 'trial_start' || Boolean(input.fullName) || Boolean(input.phone)
  if (typed) {
    const v = validateCardHolder({ fullName: input.fullName ?? '', phone: input.phone ?? '' })
    if ('field' in v) return { ok: false, field: v.field, message: v.message }
    return { ok: true, holder: { fullName: v.fullName, phone: v.phone, email: requester.email } }
  }
  const previous = await getLatestConfirmedPaymentMethod(requester.agencyId)
  if (!previous) return { ok: false, field: 'fullName', message: 'יש להזין שם פרטי ושם משפחה, באותיות בלבד' }
  return { ok: true, holder: previous.holder }
}

async function providerUnavailable(requester: CardSetupRequester, purpose: PaymentMethodPurpose): Promise<StartCardSetupResult> {
  await track({ agencyId: requester.agencyId, userId: requester.id, event: 'card_setup_failed', props: { stage: 'create', reason: 'provider_unavailable', purpose } })
  return { error: 'provider_unavailable' }
}

export async function startCardSetupForUser(
  requester: CardSetupRequester,
  input: StartCardSetupInput,
  deps = { createTokenOnlyProcess },
): Promise<StartCardSetupResult> {
  if (!isAdmin(requester.role)) return { error: 'unauthorized' }

  // The local demo mock replaces Grow entirely on a developer machine; it fails
  // closed everywhere else, where the real runtime guard decides (localMock.ts).
  const mocked = isGrowLocalMockEnabled()
  let mode: 'sandbox' | 'production'
  try {
    mode = mocked ? 'sandbox' : assertGrowRuntime().mode
  } catch (err) {
    console.error('[CardSetup] Grow runtime not allowed', { err: String(err) })
    return providerUnavailable(requester, input.purpose)
  }

  if (!(await isCardSetupEligible(requester.agencyId, input.purpose))) return { error: 'not_eligible' }
  if (needsTerms(input.purpose) && input.acceptedTerms !== true) return { error: 'terms_required' }
  // Required for EVERY purpose, card_update included: a replacement is still a
  // new card being put on file, and that is the permission this consent covers.
  if (input.acceptedCardStorage !== true) return { error: 'card_storage_consent_required' }
  const holder = await resolveHolder(requester, input)
  if ('field' in holder) return { error: 'invalid_holder', field: holder.field, message: holder.message }

  const reference = randomBytes(16).toString('hex')
  const methodId = await createPendingPaymentMethod({
    agencyId: requester.agencyId,
    createdByUserId: requester.id,
    providerMode: mode,
    purpose: input.purpose,
    reference,
    holder: holder.holder,
    termsVersion: needsTerms(input.purpose) ? CARD_TRIAL_TERMS_VERSION : null,
    cardStorageConsentVersion: CARD_STORAGE_CONSENT_VERSION,
  })
  // One live setup per agency: a callback for an older page can no longer activate anything.
  await supersedePendingPaymentMethods(db, requester.agencyId, 'superseded_by_newer_setup', methodId)

  try {
    const origin = mocked ? localMockOrigin() : publicAppOrigin()
    const createProcess = mocked ? localMockCreateTokenOnlyProcess : deps.createTokenOnlyProcess
    const grow = await createProcess({
      holder: holder.holder,
      reference,
      description: TOKEN_PROCESS_DESCRIPTION,
      successUrl: `${origin}/billing/success?source=${SUCCESS_SOURCE[input.purpose]}`,
      cancelUrl: input.purpose === 'trial_start' ? `${origin}/dashboard` : `${origin}/settings/update_payment`,
      notifyUrl: `${origin}/api/payments/grow/notify`,
    })
    await attachSetupProcess(methodId, grow.processId, grow.processToken)
    await track({ agencyId: requester.agencyId, userId: requester.id, event: 'card_setup_started', props: { purpose: input.purpose } })
    return { ok: true, url: grow.url }
  } catch (err) {
    await markPaymentMethodStatus(db, methodId, 'removed', 'process_create_failed')
    console.error('[CardSetup] createPaymentProcess failed', { agencyId: requester.agencyId, purpose: input.purpose, err: String(err) })
    return providerUnavailable(requester, input.purpose)
  }
}
