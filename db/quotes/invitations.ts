import type { Knex } from 'knex'
import { db } from '@/config/db'
import { recordQuoteEvent } from './events'

/**
 * sales_quote_invitations: the durable delivery authorization behind an email
 * invitation (migration 20261114120000). System-level: every caller passes the
 * agency it resolved from trusted context, never from the customer.
 *
 * THE CLAIM IS THE DUPLICATE GUARD, under the same quote row lock an edit and a
 * send take: "this exact version, PDF and amount are still current", "nothing is
 * out with the customer already" and "no live invitation to this address" are one
 * decision, backed by the partial unique index.
 */

const T = 'sales_quote_invitations'

/** At most this many invitation emails to one address of one business per rolling 24 hours, whatever the quote or version. */
export const INVITES_PER_ADDRESS_PER_DAY = 3

export type InvitationState = 'sending' | 'sent' | 'failed' | 'unknown' | 'redeemed' | 'invalidated'
export type InvitationRow = {
  id: number
  agencyId: number
  quoteId: number
  quoteVersion: number
  documentId: number
  contentHash: string
  totalAmount: number
  actionId: string
  leadId: number
  approvedByUserId: number | null
  customerPhoneE164: string
  businessPhoneNumberId: string
  emailHash: string
  state: InvitationState
  failureCode: string | null
  invalidReason: string | null
  authorizationExpiresAt: Date
  deliveryId: number | null
}

const normal = (r: Record<string, unknown>): InvitationRow =>
  ({
    ...r,
    id: Number(r.id),
    agencyId: Number(r.agencyId),
    quoteId: Number(r.quoteId),
    quoteVersion: Number(r.quoteVersion),
    documentId: Number(r.documentId),
    leadId: Number(r.leadId),
    totalAmount: Number(r.totalAmount),
    deliveryId: r.deliveryId == null ? null : Number(r.deliveryId),
    authorizationExpiresAt: new Date(r.authorizationExpiresAt as string),
  }) as unknown as InvitationRow

export type InvitationClaimInput = {
  agencyId: number
  quoteId: number
  quoteVersion: number
  documentId: number
  contentHash: string
  actionId: string
  leadId: number
  approvedByUserId: number
  customerPhoneE164: string
  businessPhoneNumberId: string
  emailHash: string
  refHash: string
  authorizationExpiresAt: Date
  /** Today in the business timezone, YYYY-MM-DD. Not stored. */
  businessDate: string
}

export type InvitationClaim =
  | { kind: 'claimed'; invitationId: number }
  | { kind: 'duplicate'; invitation: InvitationRow }
  | { kind: 'delivery_live' }
  | { kind: 'rate_limited' }
  | { kind: 'stale'; reason: 'quote_not_found' | 'quote_not_ready' | 'quote_expired' | 'version_changed' | 'document_changed' }

export async function claimQuoteInvitation(input: InvitationClaimInput): Promise<InvitationClaim> {
  const { agencyId, quoteId } = input
  return db.transaction(async (trx): Promise<InvitationClaim> => {
    const quote = (await trx('sales_quotes').where({ id: quoteId, agencyId }).forUpdate().first('status', 'version', 'totalAmount', trx.raw(`"expiresAt"::text as "expiresOn"`))) as
      | { status: string; version: number; totalAmount: string | number; expiresOn: string | null }
      | undefined

    // A retry of this very action converges on its own row, whatever has happened since.
    const own = await trx(T).where({ actionId: input.actionId, agencyId }).first()
    if (own) return { kind: 'duplicate', invitation: normal(own) }

    if (!quote) return { kind: 'stale', reason: 'quote_not_found' }
    if (await trx('sales_quote_deliveries').where({ quoteId, agencyId }).whereNot({ state: 'failed' }).first('id')) return { kind: 'delivery_live' }
    const live = await trx(T).where({ agencyId, quoteId, quoteVersion: input.quoteVersion, emailHash: input.emailHash }).whereNot({ state: 'failed' }).first()
    if (live) return { kind: 'duplicate', invitation: normal(live) }
    if (quote.status !== 'ready') return { kind: 'stale', reason: 'quote_not_ready' }
    if (Number(quote.version) !== input.quoteVersion) return { kind: 'stale', reason: 'version_changed' }
    if (quote.expiresOn && quote.expiresOn < input.businessDate) return { kind: 'stale', reason: 'quote_expired' }

    // The cap is per ADDRESS, across quotes and versions, so it is taken under a lock on the address
    // (the quote lock alone would let two quotes to the same customer race past it).
    await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [`quote_invite:${agencyId}:${input.emailHash}`])
    const recent = await trx(T).where({ agencyId, emailHash: input.emailHash }).whereNot({ state: 'failed' }).where('createdAt', '>', trx.raw(`now() - interval '24 hours'`)).count('id as n').first()
    if (Number(recent?.n ?? 0) >= INVITES_PER_ADDRESS_PER_DAY) return { kind: 'rate_limited' }

    const doc = await trx('sales_quote_documents')
      .where({ id: input.documentId, agencyId, quoteId, isCurrent: true, status: 'ready', contentHash: input.contentHash, quoteVersion: input.quoteVersion })
      .first('id')
    if (!doc) return { kind: 'stale', reason: 'document_changed' }

    const { businessDate: _today, ...row } = input
    const r = await trx(T)
      .insert({ ...row, totalAmount: quote.totalAmount })
      .onConflict()
      .ignore()
      .returning('id')
    if (r.length === 0) {
      const winner = await trx(T).where({ agencyId, quoteId, quoteVersion: input.quoteVersion, emailHash: input.emailHash }).whereNot({ state: 'failed' }).first()
      if (winner) return { kind: 'duplicate', invitation: normal(winner) }
      return { kind: 'stale', reason: 'quote_not_ready' }
    }
    return { kind: 'claimed', invitationId: Number(r[0].id) }
  })
}

type Marks = { invitationId: number; agencyId: number; quoteId: number; quoteVersion: number; userId: number | null; actionId: string }

export async function markInvitationSent(m: Marks & { providerMessageId: string }): Promise<void> {
  await db.transaction(async (trx) => {
    await trx(T).where({ id: m.invitationId, agencyId: m.agencyId, state: 'sending' }).update({ state: 'sent', providerMessageId: m.providerMessageId, emailSentAt: trx.fn.now(), updatedAt: trx.fn.now() })
    await recordQuoteEvent({ agencyId: m.agencyId, quoteId: m.quoteId, quoteVersion: m.quoteVersion, type: 'invite_sent', actorUserId: m.userId, actionId: m.actionId, detail: { invitationId: m.invitationId } }, trx)
  })
}

/** Certainly not sent: the reference dies with it, and a new approval may try again. */
export async function markInvitationFailed(m: Marks & { code: string }): Promise<void> {
  await db.transaction(async (trx) => {
    await trx(T).where({ id: m.invitationId, agencyId: m.agencyId, state: 'sending' }).update({ state: 'failed', failureCode: m.code, updatedAt: trx.fn.now() })
    await recordQuoteEvent({ agencyId: m.agencyId, quoteId: m.quoteId, quoteVersion: m.quoteVersion, type: 'invite_failed', actorUserId: m.userId, actionId: m.actionId, detail: { invitationId: m.invitationId, code: m.code } }, trx)
  })
}

/** The provider may have taken it. Stays live, so it is never emailed again without a person looking. */
export async function markInvitationUnknown(m: Marks): Promise<void> {
  await db.transaction(async (trx) => {
    await trx(T).where({ id: m.invitationId, agencyId: m.agencyId, state: 'sending' }).update({ state: 'unknown', updatedAt: trx.fn.now() })
    await recordQuoteEvent({ agencyId: m.agencyId, quoteId: m.quoteId, quoteVersion: m.quoteVersion, type: 'invite_unknown', actorUserId: m.userId, actionId: m.actionId, detail: { invitationId: m.invitationId } }, trx)
  })
}

/** Whose invitation email a provider event is about: only the agency and lead, for suppression and blocking. */
export async function findInvitationEmailOwner(providerMessageId: string): Promise<{ agencyId: number; leadId: number } | null> {
  const row = (await db(T).where({ providerMessageId }).first('agencyId', 'leadId')) as { agencyId: number; leadId: number } | undefined
  return row ? { agencyId: Number(row.agencyId), leadId: Number(row.leadId) } : null
}

export async function findInvitationByAction(agencyId: number, actionId: string): Promise<InvitationRow | null> {
  const row = await db(T).where({ agencyId, actionId }).first()
  return row ? normal(row) : null
}

/**
 * The invitation a customer's WhatsApp message answers: found by the reference's
 * hash, and only when the message came from the exact agency, business number and
 * customer number it was bound to. Anything else is no match at all.
 */
export async function matchInboundInvitation(
  executor: Knex | Knex.Transaction,
  input: { agencyId: number; businessPhoneNumberId: string; customerPhoneE164: string; refHash: string },
): Promise<InvitationRow | null> {
  const row = await executor(T)
    .where({ refHash: input.refHash, agencyId: input.agencyId, businessPhoneNumberId: input.businessPhoneNumberId, customerPhoneE164: input.customerPhoneE164 })
    .whereIn('state', ['sent', 'unknown'])
    .first()
  return row ? normal(row) : null
}

/** Single use: exactly one caller turns a live invitation into a redemption. */
export async function redeemInvitation(invitationId: number, agencyId: number): Promise<InvitationRow | null> {
  const [row] = await db(T).where({ id: invitationId, agencyId }).whereIn('state', ['sent', 'unknown']).update({ state: 'redeemed', redeemedAt: db.fn.now(), updatedAt: db.fn.now() }).returning('*')
  if (!row) return null
  const inv = normal(row)
  await recordQuoteEvent({ agencyId, quoteId: inv.quoteId, quoteVersion: inv.quoteVersion, type: 'invite_redeemed', actionId: inv.actionId, detail: { invitationId } })
  return inv
}

export async function invalidateInvitation(inv: InvitationRow, reason: string): Promise<void> {
  await db.transaction(async (trx) => {
    await trx(T).where({ id: inv.id, agencyId: inv.agencyId }).whereIn('state', ['sending', 'sent', 'unknown', 'redeemed']).update({ state: 'invalidated', invalidReason: reason, invalidatedAt: trx.fn.now(), updatedAt: trx.fn.now() })
    await recordQuoteEvent({ agencyId: inv.agencyId, quoteId: inv.quoteId, quoteVersion: inv.quoteVersion, type: 'invite_refused', actionId: inv.actionId, detail: { invitationId: inv.id, reason } }, trx)
  })
}

export async function linkInvitationDelivery(inv: InvitationRow, deliveryId: number): Promise<void> {
  await db(T).where({ id: inv.id, agencyId: inv.agencyId, state: 'redeemed' }).update({ deliveryId, updatedAt: db.fn.now() })
}
