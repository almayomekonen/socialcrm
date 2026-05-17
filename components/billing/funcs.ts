import type { DocState, DocumentKind, FulfillState } from '@/db/billing/invoices'
import { formatDocumentIdentity } from '@/lib/billing/numbering'

const DOC_STATE_LABELS: Record<DocState, string> = {
  draft: 'טיוטה',
  issued: 'הונפקה',
  voided: 'בוטלה',
  replaced: 'הוחלפה',
}

const FULFILL_STATE_LABELS: Record<FulfillState, string> = {
  open: 'ממתינה לתשלום',
  partial: 'תשלום חלקי',
  paid: 'שולמה',
  overdue: 'באיחור',
  written_off: 'נמחקה',
}

export function docStateLabel(state: DocState): string {
  return DOC_STATE_LABELS[state] ?? state
}

export function fulfillStateLabel(state: FulfillState | null): string {
  if (!state) return ''
  return FULFILL_STATE_LABELS[state] ?? state
}

export function formatInvoiceNumber(invoice: {
  documentNumber: number | null
  documentYear: number | null
  docState: DocState
  kind: DocumentKind
}): string {
  if (invoice.docState === 'draft' || invoice.documentNumber == null) {
    return 'טיוטה ללא מספר'
  }
  return formatDocumentIdentity({
    documentNumber: invoice.documentNumber,
    docState: invoice.docState,
    kind: invoice.kind,
  })
}
