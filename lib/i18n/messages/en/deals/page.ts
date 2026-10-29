import type { Messages } from '../../../translate'

type D = Messages['deals']

export const page: D['page'] = {
  title: 'Deals',
  description: 'Manage deals and leads',
  summary: { revenueMonth: 'Revenue this month', revenueTotal: 'Total revenue', dealsTotal: 'Total deals' },
  formDialog: 'Deal form',
}

export const table: D['table'] = {
  header: {
    offrDt: 'Inquiry date',
    clientData: 'Customer',
    status: 'Status',
    company: 'Supplier',
    prdct: 'Service',
    userName: 'Rep',
    amount: 'Deal amount',
    saleDt: 'Deal date',
    action: 'Type',
    handlerName: 'Owner',
    leadSource: 'Source',
    bizName: 'Business name',
    notes: 'Notes',
  },
  actions: 'Actions',
  search: 'Search deals',
  deleteSelected: 'Delete ({count})',
  deleteAll: 'Delete all ({count})',
  import: 'Import deals',
  add: 'Add deal',
  empty: { title: 'No deals yet', body: 'To get started, go to your leads and close a deal', toLeads: 'Go to leads' },
  menu: { delete: 'Delete', edit: 'Edit', addFavorite: 'Add to favorites' },
  confirmDelete: 'Delete',
  bulkConfirm: { one: 'Delete {count} deal?', other: 'Delete {count} deals?' },
  deleteOneConfirm: 'Delete the deal of {name}?',
  skipped: {
    one: '{count} deal was not deleted (no permission or not found)',
    other: '{count} deals were not deleted (no permission or not found)',
  },
  toast: {
    bulkDeleted: 'The deals were deleted',
    deleted: 'The deal was deleted',
    statusUpdated: 'Status updated',
    favoriteAdded: 'The deal was added to favorites',
    favoriteRemoved: 'The deal was removed from favorites',
  },
}

export const group: D['group'] = {
  placeholder: 'Actions',
  statusHead: 'Update status',
  deleteHead: 'Delete',
  favoritesHead: 'Favorites',
  delete: 'Delete the deals',
  addFavorite: 'Add to favorites',
  removeFavorite: 'Remove from favorites',
  confirm: {
    delete: 'Delete the selected deals?',
    addFavorite: 'Add the selected deals to favorites?',
    removeFavorite: 'Remove the selected deals from favorites?',
    status: 'Change the status of the selected deals to {status}?',
  },
  toast: {
    deleted: 'The deals were deleted',
    deleteFailed: 'Error, the deals were not deleted',
    favoritesAdded: 'The deals were added to favorites',
    favoritesRemoved: 'The deals were removed from favorites',
    statusUpdated: 'Status updated',
  },
}
