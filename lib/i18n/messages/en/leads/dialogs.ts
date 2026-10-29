import type { Messages } from '../../../translate'

type L = Messages['leads']

export const dialog: L['dialog'] = {
  leadDetails: 'Lead details',
  bulkAssign: 'Assign leads to a rep',
  assignOne: 'Assign lead to a rep',
  upload: 'Upload leads',
  deal: 'Deal form',
  bulkDeleteLeads: { one: 'Delete {count} lead?', other: 'Delete {count} leads?' },
  bulkDeleteCustomers: { one: 'Delete {count} customer?', other: 'Delete {count} customers?' },
  deleteLead: 'Delete the lead {name}?',
  deleted: 'Lead deleted',
  newArrived: { one: 'A new lead arrived', other: '{count} new leads arrived' },
}

export const deleteError: L['deleteError'] = {
  noPermission: "You don't have permission to delete this lead",
  notFound: 'The lead was not found or was already deleted',
  hasBilling: "Can't delete — {reason}",
  billingLinked: 'the lead is linked to the billing system',
  generic: "Couldn't delete the lead",
}

export const deleteResult: L['deleteResult'] = {
  reason: {
    billing_profile: 'it has an active billing profile',
    invoices: 'it has invoices',
    financial_events: 'it has financial transactions',
  },
  none: 'No leads were deleted',
  allDeleted: { one: '1 lead deleted', other: '{count} leads deleted' },
  deleted: { one: '1 lead deleted', other: '{count} leads deleted' },
  blockedOne: "1 lead wasn't deleted because {reason}",
  blockedMany: {
    one: "{count} lead wasn't deleted because it has billing records",
    other: "{count} leads weren't deleted because they have billing records",
  },
}

export const assignResult: L['assignResult'] = {
  already: 'These leads are already assigned to this rep',
  partial: 'Leads assigned: {assigned}. Already assigned: {skipped}',
  done: { one: 'Lead assigned to the rep', other: '{count} leads assigned to the rep' },
}
