import type { Messages } from '../../../translate'

type L = Messages['leads']

export const empty: L['empty'] = {
  noMatchLeads: 'No matching leads',
  noMatchCustomers: 'No matching customers',
  searchNarrowsLeads: "Your search is narrowing the list. Your leads are still here — nothing was lost.",
  searchNarrowsCustomers: "Your search is narrowing the list. Your customers are still here — nothing was lost.",
  filterNarrowsLeads: "A filter is narrowing the list. Your leads are still here — nothing was lost.",
  filterNarrowsCustomers: "A filter is narrowing the list. Your customers are still here — nothing was lost.",
  showAllLeads: 'Show all leads',
  showAllCustomers: 'Show all customers',
  noLeadsYet: 'No leads yet',
  noCustomersYet: 'No customers yet',
  leadsHint: 'Connect Facebook or add a lead manually',
  customersHint: 'Start by creating a lead or uploading a file',
  addLead: 'Add lead',
  uploadLeads: 'Upload leads',
  tabEmpty: 'No leads in this status right now',
  showInStatus: 'Show leads in "{status}" ({n})',
  addManually: 'Add a lead manually',
  or: ' or ',
  uploadFile: 'upload a leads file',
  loading: 'Loading…',
}

export const page: L['page'] = {
  leadsTitle: 'Leads',
  leadsDescription: 'All your leads',
  clientsTitle: 'Customers',
  clientsDescription: 'All your customers',
  clientsExplainer: 'Customers are leads that closed a deal',
}
