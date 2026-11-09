import type { Knex } from 'knex'

/**
 * The ONE write path for a quote header and its items.
 *
 * Shared by `createQuoteFromTemplateSystem` (automations, from a template) and
 * `createQuoteSystem` (owner-stated lines), so the idempotent insert exists once.
 *
 * Always inserts a DRAFT. Moving it on (numbering, `ready`) is the caller's next
 * step inside the same transaction — keeping the insert status-free means a
 * conflict can never have allocated a number first.
 *
 * IDEMPOTENT ON `automationKey`. `ON CONFLICT ... DO NOTHING` names the partial
 * unique index's columns AND its predicate, which Postgres needs to infer a
 * partial index. A bare `ON CONFLICT DO NOTHING` would also swallow every other
 * unique violation. When the key is taken this returns `{ conflict: true }` and
 * writes nothing; the caller reads the winner.
 */

export type QuoteInsertHeader = {
  templateId: number | null
  title: string
  currency: string
  locale: string
  introText: string
  termsText: string
  /** `YYYY-MM-DD`, or null for a quote with no stated validity. */
  expiresAt: string | null
  recipientNameSnapshot: string
  recipientEmailSnapshot: string
  recipientPhoneSnapshot: string
  subtotalAmount: number
  taxAmount: number
  discountAmount: number
  totalAmount: number
  metadata?: Record<string, unknown>
}

export type QuoteInsertItem = {
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
}

export type QuoteInsertInput = {
  agencyId: number
  leadId: number
  createdByUserId: number
  ownerUserId: number | null
  automationKey: string | null
  header: QuoteInsertHeader
  items: readonly QuoteInsertItem[]
}

export async function insertQuoteWithItems(
  trx: Knex.Transaction,
  input: QuoteInsertInput,
): Promise<{ quoteId: number } | { conflict: true }> {
  const { header: h, agencyId } = input
  const inserted = await trx.raw(
    `
    INSERT INTO sales_quotes (
      "agencyId","leadId","createdByUserId","ownerUserId","templateId",status,
      title,currency,locale,
      "subtotalAmount","taxAmount","discountAmount","totalAmount",
      "recipientNameSnapshot","recipientEmailSnapshot","recipientPhoneSnapshot",
      "introText","termsText","expiresAt","automationKey",metadata
    ) VALUES (
      :agencyId,:leadId,:createdByUserId,:ownerUserId,:templateId,'draft',
      :title,:currency,:locale,
      :subtotalAmount,:taxAmount,:discountAmount,:totalAmount,
      :recipientName,:recipientEmail,:recipientPhone,
      :introText,:termsText,:expiresAt::date,:automationKey,:metadata::jsonb
    )
    ON CONFLICT ("agencyId","automationKey") WHERE "automationKey" IS NOT NULL DO NOTHING
    RETURNING id
    `,
    {
      agencyId,
      leadId: input.leadId,
      createdByUserId: input.createdByUserId,
      ownerUserId: input.ownerUserId,
      templateId: h.templateId,
      title: h.title,
      currency: h.currency,
      locale: h.locale,
      subtotalAmount: h.subtotalAmount,
      taxAmount: h.taxAmount,
      discountAmount: h.discountAmount,
      totalAmount: h.totalAmount,
      recipientName: h.recipientNameSnapshot,
      recipientEmail: h.recipientEmailSnapshot,
      recipientPhone: h.recipientPhoneSnapshot,
      introText: h.introText,
      termsText: h.termsText,
      expiresAt: h.expiresAt,
      automationKey: input.automationKey,
      metadata: JSON.stringify(h.metadata ?? {}),
    },
  )

  const quoteId = inserted?.rows?.[0]?.id ? Number(inserted.rows[0].id) : null
  if (quoteId == null) return { conflict: true }

  if (input.items.length > 0) {
    await trx('sales_quote_items').insert(
      input.items.map((i) => ({
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
  }
  return { quoteId }
}
