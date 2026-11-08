import { z } from 'zod'

/**
 * WhatsApp-only actions (the web Agent drops them: its action card cannot
 * render them). All target a lead, so the gate's evidence rule covers them.
 */
export const updateLeadStatusProposal = z.object({
  actionType: z.literal('update_lead_status'),
  args: z.object({
    clientId: z.number(),
    /** One of the five SocialCRM status codes: new | contacted | interested | closed | lost. */
    status: z.string(),
  }),
  evidenceRefs: z.array(z.string()),
})

/**
 * A quote for a lead, from the owner's OWN figures. Every number nullable
 * rather than optional (Structured Outputs requires every key): null means "not
 * said", and the application asks instead of guessing. The model never computes
 * VAT or totals; the application does, and the card shows them.
 */
export const createQuoteProposal = z.object({
  actionType: z.literal('create_quote'),
  args: z.object({
    clientId: z.number(),
    /** What the quote is for, in the owner's words ("שיפוץ מטבח"). */
    title: z.string(),
    lines: z.array(
      z.object({
        title: z.string(),
        /** Null when no quantity was said. */
        quantity: z.union([z.number(), z.null()]),
        /** The price the owner said for this item, exactly. Null when none was said. */
        unitAmount: z.union([z.number(), z.null()]),
        /** A discount AMOUNT the owner said for this item, or null. */
        discountAmount: z.union([z.number(), z.null()]),
        /** A discount PERCENT the owner said ("10%" → 10), or null. The application computes the amount. */
        discountPercent: z.union([z.number(), z.null()]),
      }),
    ),
    /** "כולל מע"מ" → incl_vat, "לפני/פלוס מע"מ" → excl_vat, otherwise null. */
    priceBasis: z.union([z.literal('incl_vat'), z.literal('excl_vat'), z.null()]),
    /** Only when the owner stated a validity period, in days. */
    validityDays: z.union([z.number(), z.null()]),
  }),
  evidenceRefs: z.array(z.string()),
})

export const addLeadNoteProposal = z.object({
  actionType: z.literal('add_lead_note'),
  args: z.object({
    clientId: z.number(),
    /** What the user asked to record, in their own words. */
    content: z.string(),
  }),
  evidenceRefs: z.array(z.string()),
})
