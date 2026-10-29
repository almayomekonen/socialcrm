import type { Messages } from '../../../translate'

type L = Messages['leadTabs']

export const billing: L['billing'] = {
  title: 'Billing',
  create: 'Create document',
  header: {
    document: 'Document',
    status: 'Status',
    amount: 'Amount',
    issuedAt: 'Issue date',
    dueAt: 'Due by',
  },
  edit: 'Edit',
  view: 'View',
  empty: {
    title: 'No invoices for this lead',
    canCreate: 'Start by issuing a first invoice',
    noPermission: "You don't have permission to issue invoices",
  },
  docState: { draft: 'Draft', issued: 'Issued', voided: 'Voided', replaced: 'Replaced' },
  fulfillState: {
    open: 'Awaiting payment',
    partial: 'Partially paid',
    paid: 'Paid',
    overdue: 'Overdue',
    written_off: 'Written off',
  },
  draftNumber: 'Draft, no number',
  identity: '{kind} {number}',
  kindShort: { invoice: 'Invoice', invoice_receipt: 'Invoice/receipt' },
  picker: {
    label: 'Choose a document type',
    title: 'Which document do you want to issue?',
    help: 'Not sure which type of document you need to issue?',
    soon: 'Coming soon',
    kind: {
      invoice_receipt: 'Invoice/receipt',
      deal_invoice: 'Proforma invoice',
      payment_request: 'Payment request',
      order: 'Order (order book)',
      quote: 'Price quote',
      credit_note: 'Credit note',
    },
  },
}
