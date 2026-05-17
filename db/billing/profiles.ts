import { db } from '@/config/db'
import { requireUser } from '@/lib/requireUser'

/**
 * Legal billing identity attached to a lead.
 *
 * Doctrine:
 *   - Not a second customer entity. The lead in `clients` is the relationship
 *     identity; this row is the legal-side snapshot source for invoices.
 *   - One active profile per (agencyId, leadId). Archived profiles can coexist
 *     for audit trail purposes once an archive flow lands.
 *   - At issue time the invoice freezes a copy of these fields onto itself.
 *     Edits here do NOT retroactively change issued invoices — only future
 *     ones snapshot the new values.
 */

export type BillingProfileState = 'active' | 'archived'

export type BillBillingProfileRow = {
  id: number
  agencyId: number
  leadId: number
  createdByUserId: number
  legalName: string
  taxId: string | null
  address: string | null
  city: string | null
  zip: string | null
  country: string
  email: string | null
  phone: string | null
  defaultCurrency: string
  locale: string
  state: BillingProfileState
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type UpsertBillingProfileInput = {
  leadId: number
  legalName: string
  taxId?: string | null
  address?: string | null
  city?: string | null
  zip?: string | null
  country?: string
  email?: string | null
  phone?: string | null
  defaultCurrency?: string
  locale?: string
  metadata?: Record<string, unknown>
}

export async function getActiveBillingProfileForLead(leadId: number): Promise<BillBillingProfileRow | null> {
  const user = await requireUser()
  const row = await db('bill_billing_profiles')
    .where({ agencyId: user.agencyId, leadId, state: 'active' })
    .first()
  return row ? normalize(row) : null
}

/**
 * Race-safe creation. If two callers attempt to create the active profile for
 * the same lead concurrently, the partial unique index makes one fail; we
 * re-read and return the winner's row. Same idiom as
 * `getOrCreateLeadConversation` in db/aiConversations.ts.
 */
export async function getOrCreateBillingProfileForLead(
  input: UpsertBillingProfileInput,
): Promise<BillBillingProfileRow> {
  const user = await requireUser()

  const lead = await db('clients').where({ id: input.leadId, agencyId: user.agencyId }).first('id')
  if (!lead) throw new Error('billing.profile.lead_not_found')

  const existing = await db('bill_billing_profiles')
    .where({ agencyId: user.agencyId, leadId: input.leadId, state: 'active' })
    .first()
  if (existing) return normalize(existing)

  const insertRow = {
    agencyId: user.agencyId,
    leadId: input.leadId,
    createdByUserId: user.id,
    legalName: input.legalName,
    taxId: input.taxId ?? null,
    address: input.address ?? null,
    city: input.city ?? null,
    zip: input.zip ?? null,
    country: input.country ?? 'IL',
    email: input.email ?? null,
    phone: input.phone ?? null,
    defaultCurrency: input.defaultCurrency ?? 'ILS',
    locale: input.locale ?? 'he',
    state: 'active' as const,
    metadata: JSON.stringify(input.metadata ?? {}),
  }

  const inserted = await db.raw(
    `
    INSERT INTO bill_billing_profiles
      ("agencyId", "leadId", "createdByUserId", "legalName", "taxId",
       address, city, zip, country, email, phone,
       "defaultCurrency", locale, state, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)
    ON CONFLICT ("agencyId", "leadId") WHERE state = 'active' DO NOTHING
    RETURNING *
    `,
    [
      insertRow.agencyId,
      insertRow.leadId,
      insertRow.createdByUserId,
      insertRow.legalName,
      insertRow.taxId,
      insertRow.address,
      insertRow.city,
      insertRow.zip,
      insertRow.country,
      insertRow.email,
      insertRow.phone,
      insertRow.defaultCurrency,
      insertRow.locale,
      insertRow.state,
      insertRow.metadata,
    ],
  )

  const insertedRow = inserted.rows?.[0]
  if (insertedRow) return normalize(insertedRow)

  // Race: another caller inserted between our existence check and our INSERT.
  // Re-read the winner.
  const winner = await db('bill_billing_profiles')
    .where({ agencyId: user.agencyId, leadId: input.leadId, state: 'active' })
    .first()
  if (!winner) throw new Error('billing.profile.resolve_failed')
  return normalize(winner)
}

function normalize(raw: Record<string, unknown>): BillBillingProfileRow {
  return {
    id: Number(raw.id),
    agencyId: Number(raw.agencyId),
    leadId: Number(raw.leadId),
    createdByUserId: Number(raw.createdByUserId),
    legalName: String(raw.legalName ?? ''),
    taxId: (raw.taxId as string | null) ?? null,
    address: (raw.address as string | null) ?? null,
    city: (raw.city as string | null) ?? null,
    zip: (raw.zip as string | null) ?? null,
    country: String(raw.country ?? 'IL'),
    email: (raw.email as string | null) ?? null,
    phone: (raw.phone as string | null) ?? null,
    defaultCurrency: String(raw.defaultCurrency ?? 'ILS'),
    locale: String(raw.locale ?? 'he'),
    state: raw.state as BillingProfileState,
    metadata:
      raw.metadata && typeof raw.metadata === 'object' ? (raw.metadata as Record<string, unknown>) : {},
    createdAt: raw.createdAt instanceof Date ? raw.createdAt.toISOString() : String(raw.createdAt),
    updatedAt: raw.updatedAt instanceof Date ? raw.updatedAt.toISOString() : String(raw.updatedAt),
  }
}
