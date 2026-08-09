import type { Knex } from 'knex'
import { db } from '@/config/db'
import { isAdmin, type Roles } from '@/types/roles'
import { resolveActiveTaxRateForLine } from '@/db/billing/taxRates'
import { buildQuoteFromTemplate } from '@/lib/quotes/fromTemplate'
import type { QuoteStatus } from '@/lib/quotes/status'
import { getQuoteTemplateSystem } from './templates'
import { resolveQuoteRecipientSystem } from './recipient'

/**
 * Quote persistence — the sales entity's data layer.
 *
 * SYSTEM-LEVEL BY CONSTRUCTION (see db/quotes/templates.ts for the full
 * rationale): explicit `agencyId`, no `requireUser()`, so one implementation
 * serves both the interactive path and the automation worker, which has no
 * session. The interactive layer that will sit above this resolves `agencyId`
 * from the session and passes it down; `agencyId` is never accepted from the
 * wire.
 *
 * KNOWS NOTHING ABOUT AUTOMATIONS. `automationKey` is an opaque string this
 * module stores and uniquely enforces. It never parses it, never imports from
 * `lib/automations/**`, and there is no `automationId` foreign key — the
 * direction of that dependency is the point.
 *
 * NOTE ON SIZE (architecture-rules §1/§6): this file is over the 250-line soft
 * limit and intentionally so. Roughly half of it is the two row types, which
 * mirror the table columns one-for-one and would be no clearer in a separate
 * file; the rest is ONE concern — quote persistence — with a single write path
 * whose transaction reads as one linear sequence. Splitting it would mean
 * passing the built quote between modules to no reader's benefit. The
 * extraction to make when it grows again is the creation path moving to
 * `db/quotes/createQuote.ts`, leaving reads and types here.
 */

export type SalesQuoteRow = {
  id: number
  agencyId: number
  leadId: number
  createdByUserId: number
  ownerUserId: number | null
  templateId: number | null
  status: QuoteStatus
  quoteNumber: number | null
  quoteYear: number | null
  title: string
  currency: string
  locale: string
  subtotalAmount: number
  taxAmount: number
  discountAmount: number
  totalAmount: number
  recipientNameSnapshot: string
  recipientEmailSnapshot: string
  recipientPhoneSnapshot: string
  introText: string
  termsText: string
  internalNotes: string
  expiresAt: string | null
  readyAt: string | null
  sentAt: string | null
  sentByUserId: number | null
  decidedAt: string | null
  declineReason: string | null
  convertedInvoiceId: number | null
  convertedAt: string | null
  automationKey: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type SalesQuoteItemRow = {
  id: number
  quoteId: number
  agencyId: number
  lineNumber: number
  title: string
  description: string
  quantity: number
  unitPrice: number
  discount: number
  taxRateId: number | null
  taxRatePercentSnapshot: number
  lineSubtotal: number
  lineTaxAmount: number
  lineTotal: number
  isOptional: boolean
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** Lead-visibility scope, the shape `db/briefing.ts` already uses. */
export type QuoteScope = { user: { role: Roles }; gotPermIds: number[] }

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * Quotes for one lead, narrowed by the caller's lead visibility.
 *
 * The agency predicate is on BOTH tables and the visibility predicate is on the
 * joined lead, because "may I see this quote" is entirely "may I see this
 * lead" — quotes have no visibility of their own. Admins are unconstrained,
 * matching `scopedLeads`.
 */
export function listQuotesForLeadQuery(
  agencyId: number,
  leadId: number,
  scope: QuoteScope,
  executor: Knex | Knex.Transaction = db,
) {
  const q = executor('sales_quotes as q')
    .innerJoin('clients as c', 'c.id', 'q.leadId')
    .where('q.agencyId', agencyId)
    .where('q.leadId', leadId)
    .where('c.agencyId', agencyId)
  if (!isAdmin(scope.user.role)) q.whereIn('c.userId', scope.gotPermIds)
  return q.select('q.*').orderBy('q.createdAt', 'desc')
}

export function getQuoteByIdQuery(agencyId: number, quoteId: number, executor: Knex | Knex.Transaction = db) {
  return executor('sales_quotes').where({ id: quoteId, agencyId }).first()
}

export function listQuoteItemsQuery(agencyId: number, quoteId: number, executor: Knex | Knex.Transaction = db) {
  return executor('sales_quote_items').where({ agencyId, quoteId }).orderBy('lineNumber', 'asc')
}

/** The idempotency lookup. Agency-scoped, because the unique index is. */
export function findQuoteByAutomationKeyQuery(
  agencyId: number,
  automationKey: string,
  executor: Knex | Knex.Transaction = db,
) {
  return executor('sales_quotes').where({ agencyId, automationKey }).first('id')
}

export async function getQuoteById(agencyId: number, quoteId: number): Promise<SalesQuoteRow | null> {
  const row = (await getQuoteByIdQuery(agencyId, quoteId)) as Record<string, unknown> | undefined
  return row ? (row as unknown as SalesQuoteRow) : null
}

export async function listQuoteItems(agencyId: number, quoteId: number): Promise<SalesQuoteItemRow[]> {
  return (await listQuoteItemsQuery(agencyId, quoteId)) as unknown as SalesQuoteItemRow[]
}

// ── Creation ────────────────────────────────────────────────────────────────

export type CreateQuoteFromTemplateInput = {
  agencyId: number
  leadId: number
  templateId: number
  createdByUserId: number
  /**
   * OPAQUE idempotency token. When set, at most one quote can ever exist for it
   * within the agency — enforced by a partial unique index, not by this code.
   * Hand-made quotes pass nothing and are unconstrained.
   */
  automationKey?: string | null
  validityDaysOverride?: number | null
  /** Injected for determinism in tests; defaults to the wall clock. */
  nowMs?: number
}

export type CreateQuoteFailure =
  | 'invalid_input'
  | 'lead_not_found'
  | 'template_not_found'
  /**
   * The idempotency key conflicted but the winning row could not then be read —
   * possible only when the other transaction has not committed. RETRYABLE: an
   * automation executor should throw so the engine's ordinary retry re-runs it.
   */
  | 'conflict_unresolved'

export type CreateQuoteResult =
  | { ok: true; quoteId: number; created: boolean }
  | { ok: false; reason: CreateQuoteFailure }

/**
 * Create a DRAFT quote from a template.
 *
 * The primitive a future `quote.create` automation executor calls, and the same
 * one an interactive "create from template" button will call. Draft only: no
 * number is allocated, nothing is rendered, nothing is sent.
 *
 * IDEMPOTENT ON `automationKey`. The insert is `ON CONFLICT DO NOTHING` against
 * the partial unique index; a caller that retries after a partial failure
 * converges on the quote that already exists and gets `created: false` rather
 * than a second quote. This is the invariant the whole automation phase depends
 * on, and it is enforced by the database rather than by a check-then-insert race.
 *
 * Prices come from the template's stored items and nowhere else. Tax comes from
 * the agency's live policy via `resolveActiveTaxRateForLine`, resolved once
 * inside the transaction so the read and the write see one snapshot.
 */
export async function createQuoteFromTemplateSystem(input: CreateQuoteFromTemplateInput): Promise<CreateQuoteResult> {
  const { agencyId, leadId, templateId, createdByUserId } = input
  if (![agencyId, leadId, templateId, createdByUserId].every((n) => Number.isInteger(n) && n > 0)) {
    return { ok: false, reason: 'invalid_input' }
  }

  const automationKey = input.automationKey?.trim() || null
  const nowMs = input.nowMs ?? Date.now()

  // Fast path: a retry finds the existing quote without opening a transaction.
  if (automationKey) {
    const existing = (await findQuoteByAutomationKeyQuery(agencyId, automationKey)) as { id: number } | undefined
    if (existing) return { ok: true, quoteId: Number(existing.id), created: false }
  }

  return db.transaction(async (trx) => {
    const recipient = await resolveQuoteRecipientSystem(agencyId, leadId, trx)
    if (!recipient) return { ok: false, reason: 'lead_not_found' as const }

    const loaded = await getQuoteTemplateSystem(agencyId, templateId, trx)
    if (!loaded) return { ok: false, reason: 'template_not_found' as const }

    // The agency's effective rate: the live VAT row filtered through the
    // business-type rule, so an exempt business quotes 0% without anyone
    // editing a template. Read inside the transaction for a consistent snapshot.
    const tax = await resolveActiveTaxRateForLine(agencyId, trx as unknown as typeof db)

    const built = buildQuoteFromTemplate({
      template: {
        id: loaded.template.id,
        title: loaded.template.title,
        introText: loaded.template.introText,
        termsText: loaded.template.termsText,
        currency: loaded.template.currency,
        locale: loaded.template.locale,
        validityDays: loaded.template.validityDays,
      },
      items: loaded.items,
      recipient: { name: recipient.name, email: recipient.email, phone: recipient.phone },
      tax: { taxRateId: tax.id, ratePercent: tax.ratePercent },
      nowMs,
      validityDaysOverride: input.validityDaysOverride ?? null,
    })

    /**
     * Conflict target names the partial index's columns AND its predicate —
     * Postgres needs both to infer a partial unique index. Targeting the index
     * rather than using a bare `ON CONFLICT DO NOTHING` matters: a bare form
     * would also silently swallow any other unique violation.
     */
    const inserted = await trx.raw(
      `
      INSERT INTO sales_quotes (
        "agencyId","leadId","createdByUserId","ownerUserId","templateId",status,
        title,currency,locale,
        "subtotalAmount","taxAmount","discountAmount","totalAmount",
        "recipientNameSnapshot","recipientEmailSnapshot","recipientPhoneSnapshot",
        "introText","termsText","expiresAt","automationKey"
      ) VALUES (
        :agencyId,:leadId,:createdByUserId,:ownerUserId,:templateId,'draft',
        :title,:currency,:locale,
        :subtotalAmount,:taxAmount,:discountAmount,:totalAmount,
        :recipientName,:recipientEmail,:recipientPhone,
        :introText,:termsText,:expiresAt::date,:automationKey
      )
      ON CONFLICT ("agencyId","automationKey") WHERE "automationKey" IS NOT NULL DO NOTHING
      RETURNING id
      `,
      {
        agencyId,
        leadId,
        createdByUserId,
        ownerUserId: recipient.ownerUserId,
        templateId: built.quote.templateId,
        title: built.quote.title,
        currency: built.quote.currency,
        locale: built.quote.locale,
        subtotalAmount: built.quote.subtotalAmount,
        taxAmount: built.quote.taxAmount,
        discountAmount: built.quote.discountAmount,
        totalAmount: built.quote.totalAmount,
        recipientName: built.quote.recipientNameSnapshot,
        recipientEmail: built.quote.recipientEmailSnapshot,
        recipientPhone: built.quote.recipientPhoneSnapshot,
        introText: built.quote.introText,
        termsText: built.quote.termsText,
        expiresAt: built.quote.expiresAt,
        automationKey,
      },
    )

    const quoteId = inserted?.rows?.[0]?.id ? Number(inserted.rows[0].id) : null

    if (quoteId == null) {
      // Someone else owns this key. Return THEIR quote; write nothing.
      const winner = automationKey
        ? ((await findQuoteByAutomationKeyQuery(agencyId, automationKey, trx)) as { id: number } | undefined)
        : undefined
      if (!winner) return { ok: false, reason: 'conflict_unresolved' as const }
      return { ok: true, quoteId: Number(winner.id), created: false }
    }

    await trx('sales_quote_items').insert(
      built.items.map((i) => ({
        quoteId,
        agencyId,
        lineNumber: i.lineNumber,
        title: i.title,
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discount: i.discount,
        taxRateId: i.taxRateId,
        taxRatePercentSnapshot: i.taxRatePercentSnapshot,
        lineSubtotal: i.lineSubtotal,
        lineTaxAmount: i.lineTaxAmount,
        lineTotal: i.lineTotal,
        isOptional: i.isOptional,
      })),
    )

    return { ok: true, quoteId, created: true }
  })
}
