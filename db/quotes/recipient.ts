import type { Knex } from 'knex'
import { db } from '@/config/db'

/**
 * Who a quote is addressed to, and who owns it.
 *
 * Read from the LEAD — deliberately not from `bill_billing_profiles`. A billing
 * profile is a legal identity, and creating one for someone who has agreed to
 * nothing would both misstate the relationship and consume that table's
 * one-active-profile-per-lead slot before the customer ever said yes.
 *
 * The values are SNAPSHOTTED onto the quote at creation, so a lead who later
 * changes their email does not silently change who a quote already sent was
 * addressed to.
 *
 * System-level: explicit `agencyId`, no session. The agency scope is in the
 * WHERE clause, so a wrong-tenant lead id resolves to null rather than leaking.
 */

export type QuoteRecipient = {
  leadId: number
  name: string
  email: string
  phone: string
  /** The lead's handler — becomes the quote's `ownerUserId`. */
  ownerUserId: number | null
}

export function quoteRecipientQuery(agencyId: number, leadId: number, executor: Knex | Knex.Transaction = db) {
  return executor('clients')
    .where({ id: leadId, agencyId })
    .first('id', 'name', 'firstName', 'lastName', 'email', 'phone', 'handlerId', 'userId')
}

/**
 * Resolve the recipient for a lead, or null when the lead does not exist in this
 * agency.
 *
 * The display name prefers the lead's stored `name`, falling back to the
 * first/last pair — the same precedence `getLeadFacts` uses, so a quote and an
 * automation activity row never disagree about what to call someone.
 *
 * `ownerUserId` falls back from `handlerId` to `userId`, matching
 * `getLeadHandlerId`: a lead with no explicit handler is still owned by whoever
 * it belongs to, and a quote with no owner has nobody to chase it.
 */
export async function resolveQuoteRecipientSystem(
  agencyId: number,
  leadId: number,
  executor: Knex | Knex.Transaction = db,
): Promise<QuoteRecipient | null> {
  if (!Number.isInteger(agencyId) || agencyId <= 0) return null
  if (!Number.isInteger(leadId) || leadId <= 0) return null

  const row = (await quoteRecipientQuery(agencyId, leadId, executor)) as
    | {
        id: number
        name: string | null
        firstName: string | null
        lastName: string | null
        email: string | null
        phone: string | null
        handlerId: number | null
        userId: number | null
      }
    | undefined
  if (!row) return null

  const composed = [row.firstName, row.lastName].filter(Boolean).join(' ')
  return {
    leadId: Number(row.id),
    name: (row.name ?? '').trim() || composed.trim(),
    email: (row.email ?? '').trim(),
    phone: (row.phone ?? '').trim(),
    ownerUserId: row.handlerId ?? row.userId ?? null,
  }
}
