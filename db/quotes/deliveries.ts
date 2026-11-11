import { db } from '@/config/db'
import { recordQuoteEvent } from './events'

/**
 * sales_quote_deliveries: one attempt to send a quote to its customer.
 *
 * THE CLAIM IS THE DUPLICATE GUARD. It runs under a row lock on the quote, the
 * same lock an edit takes, so "this exact version and PDF are still current" and
 * "nobody else is sending" are one decision. The partial unique index
 * (migration 20261112120000) backs it: a quote has at most one delivery that is
 * not `failed`, and `unknown` is never resent.
 *
 * System-level: every caller passes the agency it resolved from trusted context.
 */

const T = 'sales_quote_deliveries'

export type QuoteDeliveryState = 'sending' | 'accepted' | 'delivered' | 'read' | 'failed' | 'unknown'
export type QuoteDeliveryRow = {
  id: number
  agencyId: number
  quoteId: number
  quoteVersion: number
  documentId: number
  actionId: string
  leadId: number
  approvedByUserId: number | null
  channel: 'text' | 'template'
  state: QuoteDeliveryState
  wamid: string | null
  failureCode: string | null
  linkExpiresAt: Date
  linkRevokedAt: Date | null
}

const normal = (r: Record<string, unknown>): QuoteDeliveryRow =>
  ({ ...r, id: Number(r.id), quoteId: Number(r.quoteId), documentId: Number(r.documentId), agencyId: Number(r.agencyId), leadId: Number(r.leadId), quoteVersion: Number(r.quoteVersion) }) as unknown as QuoteDeliveryRow

export type ClaimInput = {
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
  channel: 'text' | 'template'
  linkTokenHash: string
  linkExpiresAt: Date
  /** Today in the business timezone, YYYY-MM-DD. Not stored. */
  businessDate: string
}

export type ClaimResult = { kind: 'claimed'; deliveryId: number } | { kind: 'duplicate'; delivery: QuoteDeliveryRow } | { kind: 'stale'; reason: 'quote_not_found' | 'quote_not_ready' | 'quote_expired' | 'version_changed' | 'document_changed' }

export async function claimQuoteDelivery(input: ClaimInput): Promise<ClaimResult> {
  const { agencyId, quoteId } = input
  return db.transaction(async (trx): Promise<ClaimResult> => {
    const quote = (await trx('sales_quotes').where({ id: quoteId, agencyId }).forUpdate().first('status', 'version', trx.raw(`"expiresAt"::text as "expiresOn"`))) as { status: string; version: number; expiresOn: string | null } | undefined

    // A retry of this very action converges on its own row, whatever has happened since.
    const own = await trx(T).where({ actionId: input.actionId, agencyId }).first()
    if (own) return { kind: 'duplicate', delivery: normal(own) }

    if (!quote) return { kind: 'stale', reason: 'quote_not_found' }
    const live = await trx(T).where({ quoteId, agencyId }).whereNot({ state: 'failed' }).first()
    if (live) return { kind: 'duplicate', delivery: normal(live) }
    if (quote.status !== 'ready') return { kind: 'stale', reason: 'quote_not_ready' }
    if (Number(quote.version) !== input.quoteVersion) return { kind: 'stale', reason: 'version_changed' }
    if (quote.expiresOn && quote.expiresOn < input.businessDate) return { kind: 'stale', reason: 'quote_expired' }

    const doc = await trx('sales_quote_documents')
      .where({ id: input.documentId, agencyId, quoteId, isCurrent: true, status: 'ready', contentHash: input.contentHash, quoteVersion: input.quoteVersion })
      .first('id')
    if (!doc) return { kind: 'stale', reason: 'document_changed' }

    const { businessDate: _today, ...row } = input
    const r = await trx(T).insert(row).onConflict().ignore().returning('id')
    if (r.length === 0) {
      const winner = await trx(T).where({ quoteId, agencyId }).whereNot({ state: 'failed' }).first()
      if (winner) return { kind: 'duplicate', delivery: normal(winner) }
      return { kind: 'stale', reason: 'quote_not_ready' }
    }
    return { kind: 'claimed', deliveryId: Number(r[0].id) }
  })
}

/** Meta took the message: the delivery and the quote move together. */
export async function markQuoteDeliveryAccepted(input: { deliveryId: number; agencyId: number; quoteId: number; quoteVersion: number; wamid: string; userId: number; actionId: string }): Promise<void> {
  const { deliveryId, agencyId, quoteId, quoteVersion } = input
  await db.transaction(async (trx) => {
    await trx(T).where({ id: deliveryId, agencyId, state: 'sending' }).update({ state: 'accepted', wamid: input.wamid, acceptedAt: trx.fn.now(), updatedAt: trx.fn.now() })
    await trx('sales_quotes').where({ id: quoteId, agencyId, status: 'ready', version: quoteVersion }).update({ status: 'sent', sentAt: trx.fn.now(), sentByUserId: input.userId, updatedAt: trx.fn.now() })
    await recordQuoteEvent({ agencyId, quoteId, quoteVersion, type: 'send_accepted', actorUserId: input.userId, actionId: input.actionId, detail: { deliveryId } }, trx)
  })
}

/** Certainly not sent. The link dies with it, and a new approval may try again. */
export async function markQuoteDeliveryFailed(input: { deliveryId: number; agencyId: number; quoteId: number; quoteVersion: number; code: string; userId: number; actionId: string }): Promise<void> {
  const { deliveryId, agencyId, quoteId, quoteVersion } = input
  await db.transaction(async (trx) => {
    await trx(T).where({ id: deliveryId, agencyId, state: 'sending' }).update({ state: 'failed', failureCode: input.code, failedAt: trx.fn.now(), linkRevokedAt: trx.fn.now(), updatedAt: trx.fn.now() })
    await recordQuoteEvent({ agencyId, quoteId, quoteVersion, type: 'send_failed', actorUserId: input.userId, actionId: input.actionId, detail: { deliveryId, code: input.code } }, trx)
  })
}

/** Meta may have accepted it. Stays live, so it is never sent again without a person looking. */
export async function markQuoteDeliveryUnknown(input: { deliveryId: number; agencyId: number; quoteId: number; quoteVersion: number; userId: number; actionId: string }): Promise<void> {
  const { deliveryId, agencyId, quoteId, quoteVersion } = input
  await db.transaction(async (trx) => {
    await trx(T).where({ id: deliveryId, agencyId, state: 'sending' }).update({ state: 'unknown', updatedAt: trx.fn.now() })
    await recordQuoteEvent({ agencyId, quoteId, quoteVersion, type: 'send_unknown', actorUserId: input.userId, actionId: input.actionId, detail: { deliveryId } }, trx)
  })
}

export async function findQuoteDeliveryByAction(agencyId: number, actionId: string): Promise<QuoteDeliveryRow | null> {
  const row = await db(T).where({ agencyId, actionId }).first()
  return row ? normal(row) : null
}

export async function findLiveQuoteDelivery(agencyId: number, quoteId: number): Promise<QuoteDeliveryRow | null> {
  const row = await db(T).where({ agencyId, quoteId }).whereNot({ state: 'failed' }).first()
  return row ? normal(row) : null
}

export type StatusApplied = { delivery: QuoteDeliveryRow; status: 'delivered' | 'read' | 'failed' }

/** The ladder is in the WHERE, so a redelivered or out-of-order receipt changes nothing. */
export async function applyQuoteDeliveryStatus(input: { agencyId: number; wamid: string; status: string; code?: string | null }): Promise<StatusApplied | null> {
  const { agencyId, wamid, status } = input
  if (status !== 'delivered' && status !== 'read' && status !== 'failed') return null
  const from = status === 'delivered' ? ['accepted'] : ['accepted', 'delivered']
  return db.transaction(async (trx) => {
    const stamp = status === 'delivered' ? { deliveredAt: trx.fn.now() } : status === 'read' ? { readAt: trx.fn.now() } : { failedAt: trx.fn.now(), linkRevokedAt: trx.fn.now(), failureCode: input.code ?? 'delivery_failed' }
    const [row] = await trx(T).where({ agencyId, wamid }).whereIn('state', from).update({ state: status, ...stamp, updatedAt: trx.fn.now() }).returning('*')
    if (!row) return null
    const delivery = normal(row)
    if (status === 'failed') {
      // Accepted by Meta but never reached the customer: the quote was not really sent.
      await trx('sales_quotes').where({ id: delivery.quoteId, agencyId, status: 'sent', version: delivery.quoteVersion }).update({ status: 'ready', sentAt: null, sentByUserId: null, updatedAt: trx.fn.now() })
    }
    await recordQuoteEvent({ agencyId, quoteId: delivery.quoteId, quoteVersion: delivery.quoteVersion, type: status === 'failed' ? 'delivery_failed' : status, actionId: delivery.actionId, detail: { deliveryId: delivery.id, code: input.code ?? null } }, trx)
    return { delivery, status }
  })
}

/** Exactly one caller tells the owner about this outcome. */
export async function claimOwnerDeliveryNotice(deliveryId: number, agencyId: number, kind: 'delivered' | 'failed'): Promise<boolean> {
  const column = kind === 'delivered' ? 'ownerNotifiedDeliveredAt' : 'ownerNotifiedFailedAt'
  const n = await db(T).where({ id: deliveryId, agencyId }).whereNull(column).update({ [column]: db.fn.now() })
  return Number(n) === 1
}

export type PublicDelivery = { id: number; agencyId: number; quoteId: number; quoteVersion: number; documentId: number; path: string; quoteNumber: number | string | null; recipientNameSnapshot: string | null }

/**
 * What a customer's link may open: one live delivery, its own PDF, and a quote
 * that is still out with the customer. Anything else is null, and the route
 * answers every null the same way.
 */
export async function findPublicQuoteDelivery(linkTokenHash: string, now: Date): Promise<PublicDelivery | null> {
  const row = await db(`${T} as d`)
    .join('sales_quote_documents as doc', function () {
      this.on('doc.id', '=', 'd.documentId').andOn('doc.agencyId', '=', 'd.agencyId').andOn('doc.quoteId', '=', 'd.quoteId')
    })
    .join('sales_quotes as q', function () {
      this.on('q.id', '=', 'd.quoteId').andOn('q.agencyId', '=', 'd.agencyId')
    })
    .where('d.linkTokenHash', linkTokenHash)
    .whereNull('d.linkRevokedAt')
    .where('d.linkExpiresAt', '>', now)
    .whereIn('d.state', ['accepted', 'delivered', 'read'])
    .whereIn('q.status', ['sent', 'accepted'])
    .whereRaw('q.version = d."quoteVersion"')
    .where('doc.status', 'ready')
    .first('d.id', 'd.agencyId', 'd.quoteId', 'd.quoteVersion', 'd.documentId', 'doc.path', 'q.quoteNumber', 'q.recipientNameSnapshot')
  return row ? ({ ...row, id: Number(row.id), agencyId: Number(row.agencyId), quoteId: Number(row.quoteId), quoteVersion: Number(row.quoteVersion), documentId: Number(row.documentId) } as PublicDelivery) : null
}

/** The first open only: an audit fact, not a tracking pixel. */
export async function recordQuoteLinkOpened(d: PublicDelivery): Promise<void> {
  await db.transaction(async (trx) => {
    const n = await trx(T).where({ id: d.id, agencyId: d.agencyId }).whereNull('firstOpenedAt').update({ firstOpenedAt: trx.fn.now(), updatedAt: trx.fn.now() })
    if (Number(n) === 1) await recordQuoteEvent({ agencyId: d.agencyId, quoteId: d.quoteId, quoteVersion: d.quoteVersion, type: 'link_opened', detail: { deliveryId: d.id } }, trx)
  })
}
