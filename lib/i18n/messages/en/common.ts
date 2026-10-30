import type { Messages } from '../../translate'

export const common: Messages['common'] = {
  source: { whatsapp: 'WhatsApp', facebook: 'Facebook', instagram: 'Instagram', website: 'Website', manual: 'Manual' },
  dialog: { close: 'Close', closeTitle: 'Close without saving', fallbackName: 'Dialog', confirm: 'OK', cancel: 'Cancel' },
  sheet: { working: 'Working...', selected: { one: '{count} selected', other: '{count} selected' } },
  picker: { search: 'Search…', selectAll: 'Select all', clearAll: 'Clear all' },
  table: {
    columns: 'Visible columns',
    freeSearch: '🔎︎  Search…',
    records: { one: '{count} record', other: '{count} records' },
    recordsOf: { one: '{count} of {total} records', other: '{count} of {total} records' },
    prev: 'Previous',
    next: 'Next',
    exportPdf: 'Export table to PDF',
    exportExcel: 'Export table to Excel',
    pdfTitle: 'Title',
    pdfImage: 'Upload image',
    pdfSumRow: 'Add a total row at the end of the table',
    pdfCreate: 'Create PDF',
  },
  save: 'Save',
  toast: {
    success: 'Done',
    error: 'Something went wrong',
    loading: 'Loading…',
    ban: "You don't have permission to do this",
    message: 'New message',
    pro: 'This action is available with Pro',
    proCta: 'Renew subscription',
  },
  actionFailed: 'Something went wrong, please try again',
  appError: {
    title: 'Something went wrong',
    body: 'The screen could not be loaded. You can try again, or go back to the leads list.',
    retry: 'Try again',
    back: 'Back to leads',
  },
}
