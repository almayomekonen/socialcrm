import type { Knex } from 'knex'
import { db } from '@/config/db'
import { encryptSecret, decryptSecret } from '@/lib/crypto/secrets'
import type { GrowMode } from '@/lib/payments/grow/config'
import type { CardHolder } from '@/lib/payments/grow/api'

/**
 * The Grow card token that pays for a Social CRM subscription.
 *
 * Tokens are ciphertext at rest. Only decryptCardToken/decryptSetupProcessToken
 * reveal them, and only server code calling Grow may use the result.
 */

export type PaymentMethodPurpose = 'trial_start' | 'card_update' | 'reactivate'
export type PaymentMethodStatus = 'pending' | 'active' | 'replaced' | 'invalid' | 'removed' | 'needs_review'

export type PaymentMethodRow = {
  id: number
  agencyId: number
  createdByUserId: number | null
  providerMode: GrowMode
  purpose: PaymentMethodPurpose
  status: PaymentMethodStatus
  reference: string
  holder: CardHolder
  setupProcessId: string | null
  setupProcessTokenEnc: string | null
  cardTokenEnc: string | null
  cardSuffix: string | null
  cardBrand: string | null
  cardExp: string | null
  confirmedAt: Date | null
  invalidReason: string | null
  lastCallbackAt: Date | null
  createdAt: Date
}

/** Card facts as GROW reported them on verification — never taken from the callback body. */
export type ConfirmedCard = {
  cardToken: string
  cardSuffix: string | null
  cardBrand: string | null
  cardExp: string | null
  setupTransactionId: string | null
  setupTransactionToken: string | null
  setupStatusCode: string
}

const TABLE = 'billing_payment_methods'

function mapRow(r: Record<string, any>): PaymentMethodRow {
  return {
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    createdByUserId: r.createdByUserId == null ? null : Number(r.createdByUserId),
    providerMode: r.providerMode,
    purpose: r.purpose,
    status: r.status,
    reference: r.reference,
    holder: { fullName: r.holderFullName, phone: r.holderPhone, email: r.holderEmail ?? null },
    setupProcessId: r.setupProcessId ?? null,
    setupProcessTokenEnc: r.setupProcessToken ?? null,
    cardTokenEnc: r.cardToken ?? null,
    cardSuffix: r.cardSuffix ?? null,
    cardBrand: r.cardBrand ?? null,
    cardExp: r.cardExp ?? null,
    confirmedAt: r.confirmedAt ? new Date(r.confirmedAt) : null,
    invalidReason: r.invalidReason ?? null,
    lastCallbackAt: r.lastCallbackAt ? new Date(r.lastCallbackAt) : null,
    createdAt: new Date(r.createdAt),
  }
}

const one = (r: Record<string, any> | undefined) => (r ? mapRow(r) : null)

export async function createPendingPaymentMethod(input: {
  agencyId: number
  createdByUserId: number | null
  providerMode: GrowMode
  purpose: PaymentMethodPurpose
  reference: string
  holder: CardHolder
  /** Required (DB CHECK) for trial_start and reactivate; null for card_update. */
  termsVersion: string | null
}): Promise<number> {
  const [row] = await db(TABLE)
    .insert({
      agencyId: input.agencyId,
      createdByUserId: input.createdByUserId,
      providerMode: input.providerMode,
      purpose: input.purpose,
      status: 'pending',
      reference: input.reference,
      holderFullName: input.holder.fullName,
      holderPhone: input.holder.phone,
      holderEmail: input.holder.email,
      termsVersion: input.termsVersion,
      termsAcceptedAt: input.termsVersion ? new Date() : null,
    })
    .returning('id')
  return Number(typeof row === 'object' ? row.id : row)
}

export async function attachSetupProcess(id: number, processId: string, processToken: string): Promise<void> {
  await db(TABLE)
    .where({ id, status: 'pending' })
    .update({ setupProcessId: processId, setupProcessToken: encryptSecret(processToken), updatedAt: new Date() })
}

export async function markPaymentMethodStatus(
  q: Knex,
  id: number,
  status: 'invalid' | 'removed' | 'needs_review',
  reason: string,
): Promise<void> {
  await q(TABLE).where({ id }).update({ status, invalidReason: reason, invalidatedAt: new Date(), updatedAt: new Date() })
}

/**
 * pending → invalid for every other open setup of the agency. A late Grow
 * callback for one of them then finds a non-pending row and changes nothing.
 */
export async function supersedePendingPaymentMethods(q: Knex, agencyId: number, reason: string, exceptId: number | null = null): Promise<number> {
  const query = q(TABLE).where({ agencyId, status: 'pending' })
  if (exceptId !== null) query.whereNot({ id: exceptId })
  return query.update({ status: 'invalid', invalidReason: reason, invalidatedAt: new Date(), updatedAt: new Date() })
}

/** A callback arrived but could not be verified; the row keeps its status. */
export async function recordCallbackReceived(id: number, verificationError: string | null): Promise<void> {
  await db(TABLE).where({ id }).update({ lastCallbackAt: new Date(), lastVerificationError: verificationError, updatedAt: new Date() })
}

export async function findPaymentMethodBySetupProcessId(processId: string): Promise<PaymentMethodRow | null> {
  return one(await db(TABLE).where({ provider: 'grow', setupProcessId: processId }).first())
}

export async function getPaymentMethodById(id: number, q: Knex = db): Promise<PaymentMethodRow | null> {
  return one(await q(TABLE).where({ id }).first())
}

export async function getActivePaymentMethod(agencyId: number, q: Knex = db): Promise<PaymentMethodRow | null> {
  return one(await q(TABLE).where({ agencyId, status: 'active' }).first())
}

export async function getLatestPaymentMethod(agencyId: number, q: Knex = db): Promise<PaymentMethodRow | null> {
  return one(await q(TABLE).where({ agencyId }).orderBy('id', 'desc').first())
}

export async function getLatestConfirmedPaymentMethod(agencyId: number, q: Knex = db): Promise<PaymentMethodRow | null> {
  return one(await q(TABLE).where({ agencyId }).whereNotNull('confirmedAt').orderBy('id', 'desc').first())
}

/** True once ANY card was confirmed for this agency — it is card-token billed from then on. */
export async function hasConfirmedPaymentMethod(agencyId: number, q: Knex = db): Promise<boolean> {
  return Boolean(await q(TABLE).where({ agencyId }).whereNotNull('confirmedAt').first('id'))
}

/**
 * pending → active, replacing any previous active card. Locks the row first so a
 * duplicate callback, a supersession or a cancellation that committed first
 * leaves it untouched (returns false).
 */
export async function activatePaymentMethod(trx: Knex.Transaction, method: PaymentMethodRow, card: ConfirmedCard): Promise<boolean> {
  const locked = await trx(TABLE).where({ id: method.id }).forUpdate().first('status')
  if (locked?.status !== 'pending') return false
  const now = new Date()
  await trx(TABLE).where({ agencyId: method.agencyId, status: 'active' }).update({ status: 'replaced', updatedAt: now })
  await trx(TABLE)
    .where({ id: method.id })
    .update({
      status: 'active',
      cardToken: encryptSecret(card.cardToken),
      cardSuffix: card.cardSuffix,
      cardBrand: card.cardBrand,
      cardExp: card.cardExp,
      setupTransactionId: card.setupTransactionId,
      setupTransactionToken: card.setupTransactionToken ? encryptSecret(card.setupTransactionToken) : null,
      setupStatusCode: card.setupStatusCode,
      confirmedAt: now,
      lastCallbackAt: now,
      lastVerificationError: null,
      updatedAt: now,
    })
  return true
}

export function decryptCardToken(row: PaymentMethodRow): string {
  if (!row.cardTokenEnc) throw new Error('payment_method.no_card_token')
  return decryptSecret(row.cardTokenEnc)
}

export function decryptSetupProcessToken(row: PaymentMethodRow): string {
  if (!row.setupProcessTokenEnc) throw new Error('payment_method.no_process_token')
  return decryptSecret(row.setupProcessTokenEnc)
}
