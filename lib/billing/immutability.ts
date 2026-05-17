import type { BillInvoiceRow } from '@/db/billing/invoices'

/**
 * Application-layer guards against mutation of issued invoices. The DB
 * CHECK constraint bill_invoices_post_draft_invariants enforces the
 * structural shape; these helpers give a clean, namespaced error message
 * before the DB roundtrip.
 *
 * Three separate helpers — header mutation, line edit, snapshot edit —
 * because callers should signal their intent (the error reason carries
 * the operation name). No generic policy engine; the only thing they
 * gate on is `docState`.
 *
 * Phase 2.5 has no caller yet. Phase 3 edit/save server actions invoke
 * these before any UPDATE.
 */

type InvoiceStateView = Pick<BillInvoiceRow, 'docState'>

export function assertInvoiceMutable(invoice: InvoiceStateView, operation: string): void {
  if (invoice.docState !== 'draft') {
    throw new Error(`billing.immutable.${operation}_not_permitted_on_${invoice.docState}`)
  }
}

export function assertLineMutable(invoice: InvoiceStateView): void {
  if (invoice.docState !== 'draft') {
    throw new Error('billing.immutable.line_edit_not_permitted')
  }
}

export function assertSnapshotMutable(invoice: InvoiceStateView): void {
  if (invoice.docState !== 'draft') {
    throw new Error('billing.immutable.snapshot_edit_not_permitted')
  }
}
