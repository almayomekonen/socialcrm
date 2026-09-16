import { db } from '@/config/db'
import { getAgencyTrial } from '@/db/trial'
import { getTrialState } from '@/lib/trial'
import { getActivePaymentMethod, getLatestPaymentMethod, type PaymentMethodRow } from '@/db/payments/paymentMethods'
import { firstChargeAt } from './firstCharge'

/**
 * Everything the customer-facing surfaces may say about card-token billing,
 * read from OUR rows — one server read model so the billing page, the expired
 * screen and the welcome modal cannot tell different stories.
 *
 * `setup` is what the customer's card-setup attempt is doing; `payment` is what
 * the money is doing. They are separate on purpose: a confirmed card with a
 * charge whose outcome is unknown is not a failed setup.
 */

export type CardSetupPhase = 'none' | 'in_progress' | 'awaiting_verification' | 'confirmed' | 'failed'
export type CardPaymentPhase = 'none' | 'scheduled' | 'in_progress' | 'unknown' | 'declined' | 'paid'

export type CardTrialView = {
  hasActiveCard: boolean
  setup: CardSetupPhase
  payment: CardPaymentPhase
  card: { suffix: string | null; brand: string | null } | null
  cancelAtPeriodEnd: boolean
  /** From the PERSISTED trial end (or the paid period's expiry) — never recomputed. */
  firstChargeAt: Date | null
  /** True once any card was confirmed: this agency is billed by token, not by Payment Link. */
  cardBilled: boolean
}

function setupPhaseOf(latest: PaymentMethodRow | null, active: PaymentMethodRow | null): CardSetupPhase {
  if (active) return 'confirmed'
  if (!latest) return 'none'
  if (latest.status === 'pending') return latest.lastCallbackAt ? 'awaiting_verification' : 'in_progress'
  if (latest.status === 'replaced') return 'confirmed'
  return 'failed'
}

function paymentPhaseOf(charge: { status: string; dispatchedAt: Date | null } | undefined): CardPaymentPhase {
  if (!charge) return 'none'
  if (charge.status === 'succeeded') return 'paid'
  if (charge.status === 'unknown') return 'unknown'
  if (charge.status === 'in_flight') return charge.dispatchedAt ? 'in_progress' : 'scheduled'
  if (charge.status === 'pending') return 'scheduled'
  if (charge.status === 'failed_final' || charge.status === 'failed_retryable') return 'declined'
  return 'none'
}

export async function getCardTrialView(agencyId: number): Promise<CardTrialView> {
  const [latest, active, trialRow, sub, charge] = await Promise.all([
    getLatestPaymentMethod(agencyId),
    getActivePaymentMethod(agencyId),
    getAgencyTrial(agencyId),
    db('subscriptions').where({ agencyId }).first('cancelAtPeriodEnd', 'expiresAt'),
    db('billing_charges').where({ agencyId }).orderBy('id', 'desc').first('status', 'dispatchedAt'),
  ])

  const state = trialRow ? getTrialState(trialRow, new Date()) : null
  const paid = state?.status === 'PAID'
  return {
    hasActiveCard: Boolean(active),
    setup: setupPhaseOf(latest, active),
    payment: paymentPhaseOf(charge),
    card: active ? { suffix: active.cardSuffix, brand: active.cardBrand } : null,
    cancelAtPeriodEnd: Boolean(sub?.cancelAtPeriodEnd),
    firstChargeAt: firstChargeAt(paid ? sub?.expiresAt : trialRow?.trialEndsAt),
    cardBilled: Boolean(latest?.confirmedAt || active),
  }
}
