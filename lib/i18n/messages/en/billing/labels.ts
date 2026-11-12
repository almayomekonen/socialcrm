import type { Messages } from '../../../translate'

type B = Messages['billing']

export const paymentMethod: B['paymentMethod'] = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  credit_card: 'Credit card',
  check: 'Check',
  digital: 'Digital payment',
  other_method: 'Other',
}

export const issueError: B['issueError'] = {
  external_issuer: 'This business issues its documents through SmartBee, so they cannot be issued here',
  payment_exceeds_total: 'The amount received cannot be more than the document total',
  payment_incomplete: 'Complete the payment details',
  issuer_identity_incomplete: 'Complete the business details',
  no_permission: "You don't have permission to issue",
  lead_not_found: 'Lead not found',
  invoice_not_found: 'Invoice not found',
  not_draft: 'The invoice has already been issued',
  empty_lines: 'Add at least one item',
  profile_archived: 'The billing profile is not active',
  empty_legal_name: 'Enter a billing name',
  zero_total: 'The document total must be greater than zero',
  line_not_found: 'One of the items was not found',
  invalid_input: 'Invalid data',
  failed: "Couldn't issue the invoice",
}

export const picker: B['picker'] = {
  trigger: 'Choose a customer',
  search: 'Search customers...',
  none: 'No results',
  billed: 'Already billed',
  recent: 'Recent leads',
  create: 'Create a new customer',
  noName: 'No name',
  invoices: { one: '{count} invoice', other: '{count} invoices' },
  current: 'Current',
}
