import type { Messages } from '../../../translate'

type B = Messages['billing']

export const send: B['send'] = {
  title: 'Send invoice',
  kind: { invoice: 'Send invoice', invoice_receipt: 'Send invoice/receipt' },
  intro: 'The customer will get an email with a link to download the document as a PDF.',
  recipient: 'Email address to send to',
  showAdvanced: 'More options',
  hideAdvanced: 'Hide more options',
  message: 'Personal message (optional)',
  messagePlaceholder: 'Hello, the invoice is attached. Thank you!',
  submit: 'Send invoice',
  invalidEmail: 'Enter a valid email address',
  expired: 'Renewing your subscription brings back sending invoices.',
  sent: 'Invoice sent',
  error: {
    no_permission: "You don't have permission to send invoices",
    lead_not_found: 'Lead not found',
    invoice_not_found: 'Invoice not found',
    invoice_not_issued: 'The invoice is still a draft',
    pdf_not_ready: 'The PDF file is not ready yet',
    invalid_email: 'The email address is not valid',
    rate_limited: 'A request was just sent — try again in a few seconds',
    transport_failed: 'The email service refused — check the logs',
    failed: "Couldn't send the invoice",
  },
}
