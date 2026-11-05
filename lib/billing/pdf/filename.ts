/** The filename an invoice PDF is downloaded or attached under. Pure. */
export function invoicePdfFilename(invoice: { kind: string | null; documentNumber: number | null; legalNameSnapshot: string | null }): string {
  const prefix = invoice.kind === 'invoice_receipt' ? 'Receipt' : 'Invoice'
  const num = invoice.documentNumber != null ? String(invoice.documentNumber).padStart(5, '0') : 'pending'
  const name = (invoice.legalNameSnapshot ?? '').trim().replace(/\s+/g, '_').replace(/[\\/:*?"<>|]/g, '').slice(0, 80) || 'Customer'
  return `${prefix}-${num}-${name}.pdf`
}
