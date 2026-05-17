import type { Knex } from 'knex'
import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'
import { defaultVisibilityFor, type VisibilityTier } from '@/lib/billing/events/visibility'

/**
 * Append-only financial event spine.
 *
 * Doctrine:
 *   - Insert and select only. No UPDATE, no DELETE — ever. Compensating
 *     facts are NEW rows. The exported surface intentionally contains no
 *     mutating function beyond appendFinancialEvent.
 *   - Tenant scope via requireUser(). Every read filters by agencyId.
 *   - The invoice row in bill_invoices is the primary source of truth.
 *     Events supplement; they do not replace.
 *   - This module does NOT orchestrate. It persists. Callers (the issuance
 *     flow, the projection rebuilder, future payment webhooks) compose
 *     appendFinancialEvent with their own transactional logic.
 *   - appendFinancialEvent accepts an optional Knex.Transaction so the
 *     issuance flow can write the invoice mutation and its event(s) atomically.
 */

export type ActorKind = 'user' | 'system' | 'webhook' | 'projection'

export type BillFinancialEventRow = {
  id: number
  agencyId: number
  invoiceId: number | null
  leadId: number | null
  actorUserId: number | null
  actorKind: ActorKind
  eventType: string
  visibilityTier: VisibilityTier
  occurredAt: string
  recordedAt: string
  payload: Record<string, unknown>
  idempotencyKey: string | null
  metadata: Record<string, unknown>
}

export type AppendFinancialEventInput = {
  invoiceId?: number | null
  leadId?: number | null
  actorKind: ActorKind
  /**
   * Defaults to `user.id` when `actorKind === 'user'`, otherwise `null`.
   * Pass an explicit value to override.
   */
  actorUserId?: number | null
  eventType: string
  /** When omitted, derived from event-type prefix via defaultVisibilityFor. */
  visibilityTier?: VisibilityTier
  /** Logical fact time. Defaults to `new Date()`. */
  occurredAt?: Date
  payload?: Record<string, unknown>
  /** Webhook-side dedup key. Setting it makes the event idempotent per agency. */
  idempotencyKey?: string | null
  metadata?: Record<string, unknown>
}

export type ListInvoiceEventsOptions = {
  invoiceId: number
  /** 'all' returns every tier; default is 'user' for timeline UI consumers. */
  visibility?: VisibilityTier | 'all'
  /** Cursor: return rows with id strictly less than this value. */
  before?: number
  /** Clamped to [1, 200]; defaults to 50. */
  limit?: number
}

export type ListLeadFinancialEventsOptions = {
  leadId: number
  visibility?: VisibilityTier | 'all'
  before?: number
  limit?: number
}

export async function appendFinancialEvent(
  input: AppendFinancialEventInput,
  trx?: Knex.Transaction,
): Promise<number> {
  const user = await requireUser()
  const q = trx ?? db

  if (input.invoiceId == null && input.leadId == null) {
    throw new Error('billing.events.append.entity_required')
  }

  if (input.invoiceId != null) {
    const inv = await q('bill_invoices')
      .where({ id: input.invoiceId, agencyId: user.agencyId })
      .first('id')
    if (!inv) throw new Error('billing.events.append.invoice_not_found')
  }

  if (input.leadId != null) {
    const lead = await q('clients').where({ id: input.leadId, agencyId: user.agencyId }).first('id')
    if (!lead) throw new Error('billing.events.append.lead_not_found')
  }

  if (input.idempotencyKey) {
    const existing = await q('bill_financial_events')
      .where({ agencyId: user.agencyId, idempotencyKey: input.idempotencyKey })
      .first('id')
    if (existing) return Number(existing.id)
  }

  const actorUserId =
    input.actorUserId !== undefined
      ? input.actorUserId
      : input.actorKind === 'user'
        ? user.id
        : null

  const visibility = input.visibilityTier ?? defaultVisibilityFor(input.eventType)

  const [row] = await q('bill_financial_events')
    .insert({
      agencyId: user.agencyId,
      invoiceId: input.invoiceId ?? null,
      leadId: input.leadId ?? null,
      actorUserId,
      actorKind: input.actorKind,
      eventType: input.eventType,
      visibilityTier: visibility,
      occurredAt: input.occurredAt ?? new Date(),
      payload: JSON.stringify(input.payload ?? {}),
      idempotencyKey: input.idempotencyKey ?? null,
      metadata: JSON.stringify(input.metadata ?? {}),
    })
    .returning('id')

  return Number(row.id)
}

export async function listInvoiceEvents(opts: ListInvoiceEventsOptions): Promise<BillFinancialEventRow[]> {
  const user = await requireUser()
  const limit = clampLimit(opts.limit)

  const ownership = await db('bill_invoices')
    .where({ id: opts.invoiceId, agencyId: user.agencyId })
    .first('id')
  if (!ownership) return []

  let q = db('bill_financial_events')
    .where({ agencyId: user.agencyId, invoiceId: opts.invoiceId })
    .orderBy('id', 'desc')
    .limit(limit)

  const visibility = opts.visibility ?? 'user'
  if (visibility !== 'all') {
    q = q.andWhere('visibilityTier', visibility)
  }

  if (typeof opts.before === 'number' && Number.isFinite(opts.before)) {
    q = q.andWhere('id', '<', opts.before)
  }

  const rows = await q.select('*')
  return rows.map(normalize)
}

export async function listLeadFinancialEvents(
  opts: ListLeadFinancialEventsOptions,
): Promise<BillFinancialEventRow[]> {
  const user = await requireUser()
  const limit = clampLimit(opts.limit)

  const ownership = await db('clients')
    .where({ id: opts.leadId, agencyId: user.agencyId })
    .first('id')
  if (!ownership) return []

  let q = db('bill_financial_events')
    .where({ agencyId: user.agencyId, leadId: opts.leadId })
    .orderBy('id', 'desc')
    .limit(limit)

  const visibility = opts.visibility ?? 'user'
  if (visibility !== 'all') {
    q = q.andWhere('visibilityTier', visibility)
  }

  if (typeof opts.before === 'number' && Number.isFinite(opts.before)) {
    q = q.andWhere('id', '<', opts.before)
  }

  const rows = await q.select('*')
  return rows.map(normalize)
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 50, 1), 200)
}

function normalize(raw: Record<string, unknown>): BillFinancialEventRow {
  return {
    id: Number(raw.id),
    agencyId: Number(raw.agencyId),
    invoiceId: raw.invoiceId == null ? null : Number(raw.invoiceId),
    leadId: raw.leadId == null ? null : Number(raw.leadId),
    actorUserId: raw.actorUserId == null ? null : Number(raw.actorUserId),
    actorKind: raw.actorKind as ActorKind,
    eventType: String(raw.eventType ?? ''),
    visibilityTier: raw.visibilityTier as VisibilityTier,
    occurredAt: raw.occurredAt instanceof Date ? raw.occurredAt.toISOString() : String(raw.occurredAt),
    recordedAt: raw.recordedAt instanceof Date ? raw.recordedAt.toISOString() : String(raw.recordedAt),
    payload:
      raw.payload && typeof raw.payload === 'object' ? (raw.payload as Record<string, unknown>) : {},
    idempotencyKey: (raw.idempotencyKey as string | null) ?? null,
    metadata:
      raw.metadata && typeof raw.metadata === 'object' ? (raw.metadata as Record<string, unknown>) : {},
  }
}
