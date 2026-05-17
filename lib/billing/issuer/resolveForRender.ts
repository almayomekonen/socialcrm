import type { IssuerData, BusinessType } from './fields'

/**
 * Resolve the issuer identity to render for an invoice.
 *
 * Phase 2.1 of the issuer-snapshot architecture. Historical documents
 * must not mutate when the agency rebrands or corrects its tax ID, so
 * issuance freezes the issuer-side fields onto bill_invoices alongside
 * the existing recipient snapshot. This helper is the single point
 * where the render-time precedence is applied:
 *
 *   1. invoice.issuer*Snapshot column (non-empty)       — frozen at issue
 *   2. liveIssuer.* (non-null)                          — drafts; legacy issued
 *   3. fallbackAgencyName                               — name only, pre-Phase-1c
 *
 * Why the live fallback at all: invoices issued before this phase have
 * empty snapshot columns by design (no backfill — see migration header
 * for the rationale). The renderer's prior behavior — read live agency
 * identity — is preserved for those rows so legacy PDFs keep rendering
 * exactly as they do today. New issuances bypass the live read entirely.
 *
 * Logo (img) is intentionally not snapshotted in this phase; the
 * resolver passes liveIssuer.img through. See migration header +
 * project memory `logo-snapshot-deferred-to-priority-6`.
 *
 * Pure. No DB access. Easy to unit-test.
 */

/**
 * The minimal invoice shape the resolver needs. Accepts the full
 * BillInvoiceRow at call sites via structural typing — but the
 * narrow shape makes unit tests independent of the full row type.
 */
export type IssuerSnapshotFields = {
  issuerNameSnapshot: string
  issuerBusinessTypeSnapshot: BusinessType | null
  issuerTaxIdSnapshot: string
  issuerAddressSnapshot: string
  issuerPhoneSnapshot: string
  issuerEmailSnapshot: string
}

export type ResolveIssuerInput = {
  invoice: IssuerSnapshotFields
  liveIssuer: IssuerData | null
  fallbackAgencyName: string
}

export function resolveIssuerForRender({ invoice, liveIssuer, fallbackAgencyName }: ResolveIssuerInput): IssuerData {
  return {
    name: pickString(invoice.issuerNameSnapshot, liveIssuer?.name) || fallbackAgencyName.trim() || null,
    businessType: invoice.issuerBusinessTypeSnapshot ?? liveIssuer?.businessType ?? null,
    taxId: pickString(invoice.issuerTaxIdSnapshot, liveIssuer?.taxId),
    address: pickString(invoice.issuerAddressSnapshot, liveIssuer?.address),
    phone: pickString(invoice.issuerPhoneSnapshot, liveIssuer?.phone),
    email: pickString(invoice.issuerEmailSnapshot, liveIssuer?.email),

    // Logo is not snapshotted in Phase 2.1. The renderer reads the
    // live img for now. When Priority 6 lands the logo plumbing, this
    // field will follow the same snapshot-first precedence.
    img: liveIssuer?.img ?? null,

    // Tier 3 has no snapshot columns by design (currency + locale are
    // already first-class invoice-level columns; the rest don't render
    // anywhere today). Pass live values through, falling back to the
    // canonical defaults if the agency row is somehow missing.
    country: liveIssuer?.country ?? 'IL',
    defaultCurrency: liveIssuer?.defaultCurrency ?? 'ILS',
    locale: liveIssuer?.locale ?? 'he',
    docNumberFormat: liveIssuer?.docNumberFormat ?? 'YYYY-NNNN',
    bankDetails: liveIssuer?.bankDetails ?? {},
  }
}

/**
 * Snapshot wins if non-empty after trim; otherwise the live value
 * (trimmed); otherwise null. Empty-string snapshots are how legacy
 * issued rows and unsaved drafts are represented in the DB — both
 * route to the live fallback.
 */
function pickString(snapshot: string, live: string | null | undefined): string | null {
  const fromSnapshot = snapshot.trim()
  if (fromSnapshot) return fromSnapshot
  const fromLive = (live ?? '').trim()
  return fromLive || null
}
