import type { Messages } from '../../../translate'

type L = Messages['leads']

export const status: L['status'] = {
  new: 'New',
  contacted: 'In progress',
  interested: 'Interested',
  closed: 'Closed',
  lost: 'Lost',
}

export const statusForm: L['statusForm'] = {
  new: 'New',
  contacted: 'In progress',
  interested: 'Interested',
  closed: 'Closed',
  lost: 'Not relevant',
}

export const table: L['table'] = {
  header: {
    name: 'Full name',
    phone: 'Phone number',
    status: 'Status',
    nextAction: 'Next action',
    leadSource: 'Source',
    userName: 'Lead owner',
    handlerName: 'Additional owner (optional)',
    email: 'Email',
    idNum: 'ID number',
    secPhone: 'Second phone',
    birthDate: 'Date of birth',
    gender: 'Gender',
    leadStatus: 'Lead status',
    lastContact: 'Last contact',
  },
  actions: 'Actions',
  customer: 'Customer',
  nextAction: {
    new: 'Call now',
    contacted: 'Follow up',
    interested: 'Close the deal',
  },
  lastContact: {
    today: 'Today',
    yesterday: 'Yesterday',
    daysAgo: { one: '{count} day ago', other: '{count} days ago' },
  },
  statusUpdated: 'Status updated',
}

export const toolbar: L['toolbar'] = {
  clearSearch: 'Clear search',
  results: { one: '1 result', other: '{count} results' },
  assigning: 'Assigning... ({n})',
  assign: 'Assign to rep ({n})',
  deleting: 'Deleting... ({n})',
  deleteAll: 'Delete all ({n})',
  delete: 'Delete ({n})',
  deleteCustomers: 'Delete customers ({n})',
  sortPriority: 'Sort: most urgent',
  sortNewest: 'Sort: newest',
  sortAria: 'Sort leads',
  newLead: 'New lead',
  newCustomer: 'New customer',
  lists: 'Lists',
  editList: 'Edit list',
  newList: 'New list',
  noRowsSelected: 'No rows are selected in the table',
}

export const action: L['action'] = {
  open: 'Open lead',
  edit: 'Edit',
  deal: 'Close deal',
  dealAnother: 'Add another deal',
  dealLost: 'Add deal (lost lead)',
  transfer: 'Transfer to another lead owner',
  delete: 'Delete',
}
